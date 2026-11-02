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
  /**
   * Which revision of a scheduled delivery this pointer wakes. Absent for
   * one-shot work, whose delivery is never re-armed, so those payloads are
   * byte-for-byte what they were before revisions existed.
   */
  revision?: number;
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
  /**
   * HMAC-SHA256 (hex) over the tuple plus its revision, present exactly when
   * `revision` is. Kept beside the original tag rather than replacing it, so a
   * consumer rolled back to code that knows only `sig` still accepts pointers
   * already in flight.
   */
  revisionSig?: string;
};

/** Bumped only if the signed content layout below ever changes. */
const BACKGROUND_JOB_QUEUE_SIGNATURE_VERSION = "v1";
const BACKGROUND_JOB_QUEUE_REVISION_SIGNATURE_VERSION = "v2";

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

function computeBackgroundJobQueueRevisionSignature(
  fields: { deliveryId: string; jobKind: string; jobId: string; revision: number },
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(
      `${BACKGROUND_JOB_QUEUE_REVISION_SIGNATURE_VERSION}.${fields.deliveryId}.${fields.jobKind}.${fields.jobId}.${fields.revision}`,
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
  const signed: SignedBackgroundJobQueuePayload = {
    ...payload,
    sig: signBackgroundJobQueuePayload(payload, secret),
  };
  if (payload.revision === undefined) return signed;
  return {
    ...signed,
    revisionSig: computeBackgroundJobQueueRevisionSignature(
      { ...payload, revision: payload.revision },
      secret,
    ),
  };
}

function isQueueRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function constantTimeHexEqual(provided: string, expected: string): boolean {
  let providedBytes: Buffer;
  let expectedBytes: Buffer;
  try {
    providedBytes = Buffer.from(provided, "hex");
    expectedBytes = Buffer.from(expected, "hex");
  } catch {
    return false;
  }
  return (
    providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
  );
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
  const fields = {
    deliveryId: candidate.deliveryId,
    jobKind: candidate.jobKind,
    jobId: candidate.jobId,
  };
  if (!constantTimeHexEqual(candidate.sig, computeBackgroundJobQueueSignature(fields, secret))) {
    return false;
  }
  if (candidate.revision === undefined) return true;
  // A revision is part of what the pointer means, so it must be authenticated
  // too: otherwise a genuine pointer could be replayed against a newer revision.
  return (
    isQueueRevision(candidate.revision) &&
    typeof candidate.revisionSig === "string" &&
    constantTimeHexEqual(
      candidate.revisionSig,
      computeBackgroundJobQueueRevisionSignature(
        { ...fields, revision: candidate.revision },
        secret,
      ),
    )
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
  /** Seconds before consumers may see the message. Omitted for immediate work. */
  delaySeconds?: number;
  /** Seconds the provider keeps the message, measured from the send. */
  retentionSeconds?: number;
};

/**
 * The provider send options for one input, naming delay and retention only
 * when the input does, so an immediate send keeps the provider's defaults.
 * Shared by the web and Eve adapters so the two cannot drift.
 */
export function backgroundJobQueueSendOptions(input: BackgroundJobQueueSendInput) {
  return {
    idempotencyKey: input.idempotencyKey,
    headers: input.headers,
    ...(input.delaySeconds !== undefined ? { delaySeconds: input.delaySeconds } : {}),
    ...(input.retentionSeconds !== undefined ? { retentionSeconds: input.retentionSeconds } : {}),
  };
}

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

/** The provider's ceiling on both message retention and delivery delay. */
export const QUEUE_MAX_RETENTION_SECONDS = 7 * 24 * 60 * 60;
/**
 * How long a scheduled message outlives its delivery time, so consumer retries
 * (a hold, a pause, a rate limit, a crash) still find it. The provider's own
 * default retention, which is also its longest publish deduplication window.
 */
export const QUEUE_RETRY_HEADROOM_SECONDS = 24 * 60 * 60;
/**
 * The furthest one message may be delayed. Work due later is sent as a
 * checkpoint at this horizon instead: the consumer reloads current state and
 * arms the next hop, so the sole wake-up never expires before it can do so.
 */
export const QUEUE_MAX_DELAY_SECONDS = QUEUE_MAX_RETENTION_SECONDS - QUEUE_RETRY_HEADROOM_SECONDS;

/** The delay and retention one send needs to wake a consumer at `deliverAt`. */
export function scheduledQueueTiming(input: { deliverAt: Date; now: Date }) {
  const untilDue = Math.ceil((input.deliverAt.getTime() - input.now.getTime()) / 1000);
  const delaySeconds = Math.min(Math.max(untilDue, 0), QUEUE_MAX_DELAY_SECONDS);
  return {
    delaySeconds,
    retentionSeconds: delaySeconds + QUEUE_RETRY_HEADROOM_SECONDS,
    checkpoint: untilDue > QUEUE_MAX_DELAY_SECONDS,
  };
}

export function buildBackgroundJobQueuePayload(
  delivery: Pick<BackgroundJobDelivery, "id" | "jobKind" | "jobId"> & { revision?: number },
): BackgroundJobQueuePayload {
  return {
    deliveryId: delivery.id,
    jobKind: delivery.jobKind,
    jobId: delivery.jobId,
    ...(delivery.revision ? { revision: delivery.revision } : {}),
  };
}

/**
 * Unique per revision. The provider suppresses a repeated key for up to a day,
 * so a re-armed delivery reusing its old key would silently never be sent.
 */
export function backgroundJobQueueIdempotencyKey(
  delivery: Pick<BackgroundJobDelivery, "id" | "jobKind" | "jobId" | "topic"> & {
    revision?: number;
  },
) {
  const key = `${delivery.jobKind}:${delivery.jobId}:${delivery.topic}:${delivery.id}`;
  return delivery.revision ? `${key}:r${delivery.revision}` : key;
}

export async function publishBackgroundJobDelivery(input: {
  store: BackgroundJobDeliveryStore;
  queue: BackgroundJobQueueSendAdapter;
  ownerUserId: string;
  deliveryId: string;
  now?: Date;
  /**
   * When consumers should first see the message. Omitted for immediate work;
   * see {@link scheduledQueueTiming} for how a far-future time is handled.
   */
  deliverAt?: Date;
  /**
   * The revision the caller armed. If the delivery has been re-armed since,
   * nothing is sent: the newer revision publishes its own pointer, and this
   * caller's `deliverAt` may be out of date.
   */
  revision?: number;
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

  if (input.revision !== undefined && delivery.revision !== input.revision) {
    return { ok: true as const, delivery, superseded: true };
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
      revision: delivery.revision,
    });
    return { ok: false as const, delivery: failed };
  }

  const timing = input.deliverAt ? scheduledQueueTiming({ deliverAt: input.deliverAt, now }) : null;
  try {
    await input.queue.send({
      topic: delivery.topic,
      payload: buildBackgroundJobQueuePayload(delivery),
      idempotencyKey: backgroundJobQueueIdempotencyKey(delivery),
      headers: {
        "x-tendnote-job-kind": delivery.jobKind,
        "x-tendnote-delivery-id": delivery.id,
      },
      ...(timing
        ? { delaySeconds: timing.delaySeconds, retentionSeconds: timing.retentionSeconds }
        : {}),
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
      revision: delivery.revision,
    });
    return { ok: false as const, delivery: failed };
  }

  const published = await input.store.markBackgroundJobDeliveryPublished({
    ownerUserId: delivery.ownerUserId,
    deliveryId: delivery.id,
    publishedAt: now,
    revision: delivery.revision,
  });
  // Re-armed while this send was in flight: the newer revision owns the row
  // and publishes its own pointer; this one will no-op on arrival.
  const superseded = published.revision !== delivery.revision;
  input.logger?.info?.("background_job_queue.published", {
    deliveryId: delivery.id,
    jobKind: delivery.jobKind,
    topic: delivery.topic,
    ...(delivery.revision ? { revision: delivery.revision } : {}),
    ...(timing ? { delaySeconds: timing.delaySeconds, checkpoint: timing.checkpoint } : {}),
    ...(superseded ? { superseded } : {}),
  });

  return { ok: true as const, delivery: published, superseded };
}
