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
