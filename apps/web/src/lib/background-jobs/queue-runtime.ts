import {
  BACKGROUND_JOB_TOPICS,
  type BackgroundJobDelivery,
  type BackgroundJobDeliveryStore,
  type BackgroundJobKind,
  topicForBackgroundJob,
} from "@tendnote/db/queries/background-job-deliveries";
import { send as sendVercelQueueMessage } from "@vercel/queue";

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

export type BackgroundJobQueueConsumerMetadata = {
  topicName?: string;
  messageId?: string;
  deliveryCount?: number;
  consumerGroup?: string;
};

export type BackgroundJobProcessorJobState =
  | { status: "ready" }
  | { status: "not_found" | "terminal" | "not_claimable"; reason?: string };

export type BackgroundJobQueueProcessor = {
  jobKind: BackgroundJobKind;
  /**
   * Reload and claim the owner-scoped processor job from Postgres. Duplicate or
   * stale queue messages must return a non-ready state through the processor's
   * normal claim/idempotency rules rather than processing twice.
   */
  claimJob: (input: {
    ownerUserId: string;
    deliveryId: string;
    jobId: string;
  }) => Promise<BackgroundJobProcessorJobState>;
  processJob: (input: {
    ownerUserId: string;
    deliveryId: string;
    jobId: string;
    metadata?: BackgroundJobQueueConsumerMetadata;
  }) => Promise<void>;
};

export const BACKGROUND_JOB_QUEUE_CONFIG = {
  extraction: {
    topic: BACKGROUND_JOB_TOPICS.extraction,
    consumerGroup: "tendnote-extraction-processor",
    maxConcurrency: 2,
    maxMessagesPerSecond: 2,
    visibilityTimeoutSeconds: 600,
    retryAfterSeconds: 60,
    rateLimitKey: "background-job:extraction",
    costCategory: "llm-extraction",
  },
  embedding: {
    topic: BACKGROUND_JOB_TOPICS.embedding,
    consumerGroup: "tendnote-embedding-processor",
    maxConcurrency: 3,
    maxMessagesPerSecond: 3,
    visibilityTimeoutSeconds: 600,
    retryAfterSeconds: 60,
    rateLimitKey: "background-job:embedding",
    costCategory: "embedding",
  },
} satisfies Record<
  BackgroundJobKind,
  {
    topic: string;
    consumerGroup: string;
    maxConcurrency: number;
    maxMessagesPerSecond: number;
    visibilityTimeoutSeconds: number;
    retryAfterSeconds: number;
    rateLimitKey: string;
    costCategory: string;
  }
>;

const DEFAULT_RETRY_DELAY_MS = 5 * 60 * 1000;

export function createVercelBackgroundJobQueueAdapter(): BackgroundJobQueueSendAdapter {
  return {
    async send(input) {
      return sendVercelQueueMessage(input.topic, input.payload, {
        idempotencyKey: input.idempotencyKey,
        headers: input.headers,
      });
    },
  };
}

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

export async function consumeBackgroundJobQueueMessage(input: {
  store: BackgroundJobDeliveryStore;
  payload: unknown;
  processors: BackgroundJobQueueProcessor[];
  metadata?: BackgroundJobQueueConsumerMetadata;
  logger?: BackgroundJobQueueLogger;
}) {
  const payload = parseBackgroundJobQueuePayload(input.payload);
  if (!payload) {
    logQueueAnomaly(input.logger, "invalid_payload", {
      messageId: input.metadata?.messageId,
      topicName: input.metadata?.topicName,
    });
    return { status: "ignored" as const, reason: "invalid_payload" as const };
  }

  const delivery = await input.store.getBackgroundJobDeliveryForConsumer(payload.deliveryId);
  if (!delivery) {
    logQueueAnomaly(input.logger, "missing_delivery", {
      deliveryId: payload.deliveryId,
      jobKind: payload.jobKind,
      jobId: payload.jobId,
    });
    return { status: "ignored" as const, reason: "missing_delivery" as const };
  }

  const expectedTopic = topicForBackgroundJob(payload.jobKind);
  if (
    delivery.jobKind !== payload.jobKind ||
    delivery.jobId !== payload.jobId ||
    delivery.topic !== expectedTopic ||
    (input.metadata?.topicName && input.metadata.topicName !== delivery.topic)
  ) {
    logQueueAnomaly(input.logger, "payload_mismatch", {
      deliveryId: delivery.id,
      deliveryJobKind: delivery.jobKind,
      payloadJobKind: payload.jobKind,
      deliveryJobId: delivery.jobId,
      payloadJobId: payload.jobId,
      deliveryTopic: delivery.topic,
      messageTopic: input.metadata?.topicName,
    });
    await recordDeliveryAnomaly(input.store, delivery, "Queue payload did not match delivery row.");
    return { status: "ignored" as const, reason: "payload_mismatch" as const };
  }

  if (delivery.status === "abandoned") {
    logQueueAnomaly(input.logger, "obsolete_delivery", {
      deliveryId: delivery.id,
      jobKind: delivery.jobKind,
    });
    await recordDeliveryAnomaly(
      input.store,
      delivery,
      "Queue payload referenced abandoned delivery.",
    );
    return { status: "ignored" as const, reason: "obsolete_delivery" as const };
  }

  if (delivery.status !== "published") {
    logQueueAnomaly(input.logger, "stale_delivery", {
      deliveryId: delivery.id,
      jobKind: delivery.jobKind,
      status: delivery.status,
    });
    await recordDeliveryAnomaly(
      input.store,
      delivery,
      `Queue payload referenced ${delivery.status} delivery.`,
    );
    return { status: "ignored" as const, reason: "stale_delivery" as const };
  }

  if ((input.metadata?.deliveryCount ?? 1) > 1) {
    logQueueAnomaly(input.logger, "duplicate_delivery", {
      deliveryId: delivery.id,
      jobKind: delivery.jobKind,
      deliveryCount: input.metadata?.deliveryCount,
    });
  }

  const processor = input.processors.find((candidate) => candidate.jobKind === payload.jobKind);
  if (!processor) {
    logQueueAnomaly(input.logger, "missing_handler", {
      deliveryId: delivery.id,
      jobKind: delivery.jobKind,
    });
    return { status: "ignored" as const, reason: "missing_handler" as const };
  }

  const jobState = await processor.claimJob({
    ownerUserId: delivery.ownerUserId,
    deliveryId: delivery.id,
    jobId: delivery.jobId,
  });

  if (jobState.status !== "ready") {
    const reason = jobState.reason ?? `Processor job is ${jobState.status.replaceAll("_", " ")}.`;
    logQueueAnomaly(input.logger, "processor_job_not_ready", {
      deliveryId: delivery.id,
      jobKind: delivery.jobKind,
      jobId: delivery.jobId,
      jobStatus: jobState.status,
      reason,
    });
    await recordDeliveryAnomaly(input.store, delivery, reason);
    return { status: "ignored" as const, reason: jobState.status };
  }

  await processor.processJob({
    ownerUserId: delivery.ownerUserId,
    deliveryId: delivery.id,
    jobId: delivery.jobId,
    metadata: input.metadata,
  });
  return { status: "processed" as const, delivery };
}

function parseBackgroundJobQueuePayload(payload: unknown): BackgroundJobQueuePayload | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as Partial<BackgroundJobQueuePayload>;
  if (
    typeof candidate.deliveryId !== "string" ||
    typeof candidate.jobId !== "string" ||
    (candidate.jobKind !== "extraction" && candidate.jobKind !== "embedding")
  ) {
    return null;
  }

  return {
    deliveryId: candidate.deliveryId,
    jobKind: candidate.jobKind,
    jobId: candidate.jobId,
  };
}

function logQueueAnomaly(
  logger: BackgroundJobQueueLogger | undefined,
  reason: string,
  metadata: Record<string, unknown>,
) {
  logger?.warn?.("background_job_queue.anomaly", { reason, ...metadata });
}

async function recordDeliveryAnomaly(
  store: BackgroundJobDeliveryStore,
  delivery: BackgroundJobDelivery,
  lastError: string,
) {
  await store.updateBackgroundJobDelivery({
    ownerUserId: delivery.ownerUserId,
    deliveryId: delivery.id,
    lastError,
  });
}
