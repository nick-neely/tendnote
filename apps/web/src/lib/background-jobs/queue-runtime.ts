import {
  BACKGROUND_JOB_TOPICS,
  type BackgroundJobDelivery,
  type BackgroundJobDeliveryStore,
  type BackgroundJobKind,
  type BackgroundJobQueueLogger,
  type BackgroundJobQueuePayload,
  type BackgroundJobQueueSendAdapter,
  topicForBackgroundJob,
} from "@tendnote/db/queries/background-job-deliveries";
import type {
  BackgroundJobProcessorJobState,
  BackgroundJobQueueConsumerMetadata,
  BackgroundJobQueueProcessor,
} from "@tendnote/db/queries/background-jobs";
import { send as sendVercelQueueMessage } from "@vercel/queue";
import type { CostCategory, ProductRateLimiter } from "@/lib/rate-limit";
import { classifyBackgroundJobFailure } from "./failure-observability";

// The outbox-publish orchestration and its transport seam live in @tendnote/db (shared by
// Eve and the web so the publish path is no longer re-inlined per app); the shared
// execution module there also owns the per-family processor contract and claim translation.
// Re-export them here so existing web consumers keep importing from "./queue-runtime"; the
// rate-limit-aware consumer runtime below stays web-owned.
export {
  type BackgroundJobQueueLogger,
  type BackgroundJobQueuePayload,
  type BackgroundJobQueueSendAdapter,
  backgroundJobQueueIdempotencyKey,
  publishBackgroundJobDelivery,
} from "@tendnote/db/queries/background-job-deliveries";
export type {
  BackgroundJobQueueConsumerMetadata,
  BackgroundJobQueueProcessor,
} from "@tendnote/db/queries/background-jobs";

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
  // Action extraction shares the extraction topic and route (dispatched by job kind) but
  // keeps its own rate-limit budget so a burst of action proposals cannot starve memory
  // extraction, and vice versa. Both are LLM-cost extraction work.
  action_extraction: {
    topic: BACKGROUND_JOB_TOPICS.action_extraction,
    consumerGroup: "tendnote-extraction-processor",
    maxConcurrency: 2,
    maxMessagesPerSecond: 2,
    visibilityTimeoutSeconds: 600,
    retryAfterSeconds: 60,
    rateLimitKey: "background-job:action-extraction",
    costCategory: "llm-extraction",
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
    // The product rate limiter's `key` and `costCategory` for this consumer.
    // Typing `costCategory` as CostCategory keeps it aligned with the limiter's
    // budget table (ADR-0068 rate-control boundary → ADR-0070 product limiter).
    rateLimitKey: string;
    costCategory: CostCategory;
  }
>;

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

export async function consumeBackgroundJobQueueMessage(input: {
  store: BackgroundJobDeliveryStore;
  payload: unknown;
  processors: BackgroundJobQueueProcessor[];
  metadata?: BackgroundJobQueueConsumerMetadata;
  logger?: BackgroundJobQueueLogger;
  /**
   * Optional product rate limiter (ADR-0070). When provided, the consumer charges
   * the owner's budget for this job's `costCategory`/`rateLimitKey` before claiming
   * the job. A denied budget defers the message for redelivery without touching
   * delivery or processor-job status, so delivery semantics stay unchanged.
   */
  rateLimiter?: ProductRateLimiter;
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

  const invalidDeliveryResult = await validatePublishedDelivery(input, delivery, payload);
  if (invalidDeliveryResult) return invalidDeliveryResult;

  if ((input.metadata?.deliveryCount ?? 1) > 1) {
    input.logger?.info?.("background_job_queue.redelivery", {
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

  if (
    (await evaluateRateLimit(input.rateLimiter, input.logger, delivery, payload)) === "deferred"
  ) {
    // Defer before claiming: no claimJob, no status write. The transport edge
    // redelivers later (backpressure), leaving delivery/job status untouched.
    return { status: "deferred" as const, reason: "rate_limited" as const };
  }

  const jobState = await processor.claimJob({
    ownerUserId: delivery.ownerUserId,
    deliveryId: delivery.id,
    jobId: delivery.jobId,
  });

  if (jobState.status !== "ready") {
    return handleUnreadyProcessorJob(input, delivery, jobState);
  }

  await processClaimedJob(input, delivery, processor);
  return { status: "processed" as const, delivery };
}

async function validatePublishedDelivery(
  input: Parameters<typeof consumeBackgroundJobQueueMessage>[0],
  delivery: BackgroundJobDelivery,
  payload: BackgroundJobQueuePayload,
) {
  const expectedTopic = topicForBackgroundJob(payload.jobKind);
  if (isPayloadDeliveryMismatch(delivery, payload, expectedTopic, input.metadata?.topicName)) {
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

  return null;
}

async function handleUnreadyProcessorJob(
  input: Parameters<typeof consumeBackgroundJobQueueMessage>[0],
  delivery: BackgroundJobDelivery,
  jobState: Exclude<BackgroundJobProcessorJobState, { status: "ready" }>,
) {
  const reason = jobState.reason ?? `Processor job is ${jobState.status.replaceAll("_", " ")}.`;
  if (jobState.status === "retry_pending") {
    input.logger?.info?.("background_job_queue.retry_pending", {
      deliveryId: delivery.id,
      jobKind: delivery.jobKind,
      jobId: delivery.jobId,
    });
    return { status: "ignored" as const, reason: "retry_pending" as const };
  }
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

async function processClaimedJob(
  input: Parameters<typeof consumeBackgroundJobQueueMessage>[0],
  delivery: BackgroundJobDelivery,
  processor: BackgroundJobQueueProcessor,
) {
  try {
    await processor.processJob({
      ownerUserId: delivery.ownerUserId,
      deliveryId: delivery.id,
      jobId: delivery.jobId,
      metadata: input.metadata,
    });
  } catch (error) {
    input.logger?.error?.("background_job_queue.processor_failed", {
      deliveryId: delivery.id,
      jobKind: delivery.jobKind,
      jobId: delivery.jobId,
      errorCode: classifyBackgroundJobFailure(error),
    });
    throw error;
  }
}

/**
 * Whether a delivery row disagrees with the queue payload it was addressed by: a
 * different job kind/id, a topic that doesn't match the payload's expected topic, or a
 * transport topic name that doesn't match the delivery's own topic. Any mismatch means
 * the message is not safely processable and is recorded as an anomaly.
 */
function isPayloadDeliveryMismatch(
  delivery: BackgroundJobDelivery,
  payload: BackgroundJobQueuePayload,
  expectedTopic: string,
  messageTopic: string | undefined,
): boolean {
  return (
    delivery.jobKind !== payload.jobKind ||
    delivery.jobId !== payload.jobId ||
    delivery.topic !== expectedTopic ||
    Boolean(messageTopic && messageTopic !== delivery.topic)
  );
}

/**
 * Charge the owner's product budget for this job before it is claimed (ADR-0070).
 * Returns `"allowed"` when no limiter is configured or the budget permits the job, and
 * `"deferred"` (after logging the anomaly) when the budget denies it — the caller then
 * defers the message for redelivery without touching delivery or processor-job status.
 */
async function evaluateRateLimit(
  rateLimiter: ProductRateLimiter | undefined,
  logger: BackgroundJobQueueLogger | undefined,
  delivery: BackgroundJobDelivery,
  payload: BackgroundJobQueuePayload,
): Promise<"allowed" | "deferred"> {
  if (!rateLimiter) return "allowed";

  const limitConfig = BACKGROUND_JOB_QUEUE_CONFIG[payload.jobKind];
  const limit = await rateLimiter.check({
    subject: delivery.ownerUserId,
    costCategory: limitConfig.costCategory,
    key: limitConfig.rateLimitKey,
  });
  if (limit.allowed) return "allowed";

  logQueueAnomaly(logger, "rate_limited", {
    deliveryId: delivery.id,
    jobKind: delivery.jobKind,
    costCategory: limitConfig.costCategory,
    reason: limit.reason,
  });
  return "deferred";
}

function parseBackgroundJobQueuePayload(payload: unknown): BackgroundJobQueuePayload | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const candidate = payload as Partial<BackgroundJobQueuePayload>;
  if (
    typeof candidate.deliveryId !== "string" ||
    typeof candidate.jobId !== "string" ||
    (candidate.jobKind !== "extraction" &&
      candidate.jobKind !== "embedding" &&
      candidate.jobKind !== "action_extraction")
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
