import { createHmac, timingSafeEqual } from "node:crypto";
import { type BackgroundJobKind, topicForBackgroundJob } from "./topics";
import type { BackgroundJobDelivery, BackgroundJobDeliveryStore } from "./types";

/**
 * Shared outbox-publish orchestration (ADR-0068). The concrete queue transport (the
 * Vercel adapter) lives in each app because it imports `@vercel/queue`; the data
 * layer stays provider-agnostic and depends only on the injected
 * {@link BackgroundJobQueueSendAdapter} seam. Both surfaces that enqueue background
 * work — Eve capture and the web actions — publish through the one
 * `publishBackgroundJobDelivery` here, so the topic check, idempotency key, and
 * published/failed transitions are defined once instead of re-inlined per app.
 */

export type BackgroundJobQueuePayload = {
  deliveryId: string;
  jobKind: BackgroundJobKind;
  jobId: string;
};

/**
 * A queue payload carrying its authenticity tag. `@vercel/queue` 0.3.1 performs no
 * inbound signature verification on callbacks: it parses the caller-controlled
 * CloudEvent and invokes the consumer directly (in binary mode, before acknowledging
 * the receipt). A forged POST to a consumer route can therefore claim paid work or
 * reach delivery lookups. We close that hole ourselves by HMAC-signing the payload at
 * publish (the one channel guaranteed to round-trip, since the payload *is* the
 * message) and verifying it at the consumer boundary before any DB access.
 */
export type SignedBackgroundJobQueuePayload = BackgroundJobQueuePayload & {
  /** HMAC-SHA256 (hex) over the (deliveryId, jobKind, jobId) tuple. */
  sig: string;
};

/** Bumped only if the signed content layout below ever changes. */
const BACKGROUND_JOB_QUEUE_SIGNATURE_VERSION = "v1";

function computeBackgroundJobQueueSignature(
  fields: { deliveryId: string; jobKind: string; jobId: string },
  secret: string,
): string {
  // The delivery id is a unique, unguessable identifier and the delivery-row state
  // machine (published → processed, plus idempotency and abandoned checks) already
  // rejects replays of a genuine message, so the tuple alone is sufficient signed
  // content: an attacker cannot mint a valid tag for any tuple without the secret, and
  // cannot lift a real tag off the wire (callbacks arrive over TLS). No timestamp is
  // signed because legitimate messages can be delayed or retried arbitrarily far out.
  return createHmac("sha256", secret)
    .update(
      `${BACKGROUND_JOB_QUEUE_SIGNATURE_VERSION}.${fields.deliveryId}.${fields.jobKind}.${fields.jobId}`,
    )
    .digest("hex");
}

/** Signature the consumer must see for this payload, given the shared secret. */
export function signBackgroundJobQueuePayload(
  payload: BackgroundJobQueuePayload,
  secret: string,
): string {
  return computeBackgroundJobQueueSignature(payload, secret);
}

/** Attach the authenticity tag so the transport publishes a self-verifying envelope. */
export function attachBackgroundJobQueueSignature(
  payload: BackgroundJobQueuePayload,
  secret: string,
): SignedBackgroundJobQueuePayload {
  return { ...payload, sig: signBackgroundJobQueuePayload(payload, secret) };
}

/**
 * Whether an inbound queue callback carries a valid signature for its own fields.
 * Returns false for any non-object, any payload missing the routing fields or the tag,
 * and any tag that does not match. The compare is constant-time.
 */
export function verifyBackgroundJobQueueSignature(message: unknown, secret: string): boolean {
  if (!message || typeof message !== "object") return false;
  const candidate = message as Partial<SignedBackgroundJobQueuePayload>;
  if (
    typeof candidate.deliveryId !== "string" ||
    typeof candidate.jobId !== "string" ||
    typeof candidate.jobKind !== "string" ||
    typeof candidate.sig !== "string"
  ) {
    return false;
  }
  const expected = computeBackgroundJobQueueSignature(
    {
      deliveryId: candidate.deliveryId,
      jobKind: candidate.jobKind,
      jobId: candidate.jobId,
    },
    secret,
  );
  let providedBytes: Buffer;
  let expectedBytes: Buffer;
  try {
    providedBytes = Buffer.from(candidate.sig, "hex");
    expectedBytes = Buffer.from(expected, "hex");
  } catch {
    return false;
  }
  return (
    providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
  );
}

/**
 * Resolve the shared secret used to sign and verify background-job queue callbacks
 * from an environment. A dedicated `BACKGROUND_JOB_QUEUE_SECRET` is preferred; it falls
 * back to `BETTER_AUTH_SECRET` (already required and shared identically across the web
 * and agent deployments) so hardening needs no new operator action by default. Returns
 * `undefined` when neither is set, which callers treat as fail-closed outside local dev.
 * Whichever value is used MUST be identical in every deployment that publishes to or
 * consumes these queues, or genuine messages will fail verification.
 */
export function resolveBackgroundJobQueueSecret(
  env: Record<string, string | undefined>,
): string | undefined {
  return env.BACKGROUND_JOB_QUEUE_SECRET?.trim() || env.BETTER_AUTH_SECRET?.trim() || undefined;
}

export type BackgroundJobQueueSendInput = {
  topic: string;
  payload: BackgroundJobQueuePayload;
  idempotencyKey: string;
  headers?: Record<string, string>;
};

export type BackgroundJobQueueSendResult = {
  messageId: string | null;
};

export type BackgroundJobQueueSendAdapter = {
  send: (input: BackgroundJobQueueSendInput) => Promise<BackgroundJobQueueSendResult>;
};

export type BackgroundJobQueueLogger = {
  info?: (message: string, metadata?: Record<string, unknown>) => void;
  warn?: (message: string, metadata?: Record<string, unknown>) => void;
  error?: (message: string, metadata?: Record<string, unknown>) => void;
};

const DEFAULT_RETRY_DELAY_MS = 5 * 60 * 1000;

export function buildBackgroundJobQueuePayload(
  delivery: Pick<BackgroundJobDelivery, "id" | "jobKind" | "jobId">,
): BackgroundJobQueuePayload {
  return {
    deliveryId: delivery.id,
    jobKind: delivery.jobKind,
    jobId: delivery.jobId,
  };
}

export function backgroundJobQueueIdempotencyKey(
  delivery: Pick<BackgroundJobDelivery, "id" | "jobKind" | "jobId" | "topic">,
) {
  return `${delivery.jobKind}:${delivery.jobId}:${delivery.topic}:${delivery.id}`;
}

export async function publishBackgroundJobDelivery(input: {
  store: BackgroundJobDeliveryStore;
  queue: BackgroundJobQueueSendAdapter;
  ownerUserId: string;
  deliveryId: string;
  now?: Date;
  retryDelayMs?: number;
  logger?: BackgroundJobQueueLogger;
}) {
  const now = input.now ?? new Date();
  const delivery = await input.store.getBackgroundJobDelivery({
    ownerUserId: input.ownerUserId,
    deliveryId: input.deliveryId,
  });

  if (!delivery) {
    throw new Error("Background job delivery not found.");
  }

  if (delivery.topic !== topicForBackgroundJob(delivery.jobKind)) {
    input.logger?.error?.("background_job_queue.topic_mismatch", {
      deliveryId: delivery.id,
      jobKind: delivery.jobKind,
      topic: delivery.topic,
    });
    const failed = await input.store.markBackgroundJobDeliveryPublishFailed({
      ownerUserId: delivery.ownerUserId,
      deliveryId: delivery.id,
      error: "Delivery topic does not match the typed topic map.",
      nextAttemptAt: new Date(now.getTime() + (input.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS)),
    });
    return { ok: false as const, delivery: failed };
  }

  try {
    await input.queue.send({
      topic: delivery.topic,
      payload: buildBackgroundJobQueuePayload(delivery),
      idempotencyKey: backgroundJobQueueIdempotencyKey(delivery),
      headers: {
        "x-tendnote-job-kind": delivery.jobKind,
        "x-tendnote-delivery-id": delivery.id,
      },
    });
  } catch (error) {
    input.logger?.error?.("background_job_queue.publish_failed", {
      deliveryId: delivery.id,
      jobKind: delivery.jobKind,
      error: error instanceof Error ? error.message : String(error),
    });
    const failed = await input.store.markBackgroundJobDeliveryPublishFailed({
      ownerUserId: delivery.ownerUserId,
      deliveryId: delivery.id,
      error: error instanceof Error ? error.message : String(error),
      nextAttemptAt: new Date(now.getTime() + (input.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS)),
    });
    return { ok: false as const, delivery: failed };
  }

  const published = await input.store.markBackgroundJobDeliveryPublished({
    ownerUserId: delivery.ownerUserId,
    deliveryId: delivery.id,
    publishedAt: now,
  });
  input.logger?.info?.("background_job_queue.published", {
    deliveryId: delivery.id,
    jobKind: delivery.jobKind,
    topic: delivery.topic,
  });

  return { ok: true as const, delivery: published };
}
