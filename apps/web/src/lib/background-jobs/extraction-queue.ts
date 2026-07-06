import {
  claimActionExtractionJob,
  type EnqueueAndTriggerActionExtractionJobInput,
  type EnqueueAndTriggerActionExtractionJobResult,
  enqueueAndTriggerActionExtractionJob,
  getActionExtractionJob,
  processActionExtractionJob,
} from "@tendnote/db/queries/action-extraction-jobs";
import {
  type BackgroundJobDeliveryStore,
  createDrizzleBackgroundJobDeliveryStore,
} from "@tendnote/db/queries/background-job-deliveries";
import {
  claimExtractionJob,
  type EnqueueAndTriggerExtractionJobInput,
  type EnqueueAndTriggerExtractionJobResult,
  enqueueAndTriggerExtractionJob,
  getExtractionJob,
  processExtractionJob,
  resolveExtractionRuntimeMode,
} from "@tendnote/db/queries/extraction-jobs";
import type { ProductRateLimiter } from "@/lib/rate-limit";
import {
  type BackgroundJobQueueConsumerMetadata,
  type BackgroundJobQueueLogger,
  type BackgroundJobQueueSendAdapter,
  consumeBackgroundJobQueueMessage,
  createVercelBackgroundJobQueueAdapter,
  publishBackgroundJobDelivery,
} from "./queue-runtime";

export type EnqueueAndPublishExtractionJobResult = EnqueueAndTriggerExtractionJobResult & {
  deliveryId: string | null;
  publishResult: Awaited<ReturnType<typeof publishBackgroundJobDelivery>> | null;
};

type EnqueueExtraction = (
  input: EnqueueAndTriggerExtractionJobInput,
) => Promise<EnqueueAndTriggerExtractionJobResult>;

export async function enqueueAndPublishExtractionJob(input: {
  ownerUserId: string;
  sourceRecordId: string;
  runtimeMode?: EnqueueAndTriggerExtractionJobInput["runtimeMode"];
  deliveryStore?: BackgroundJobDeliveryStore;
  queue?: BackgroundJobQueueSendAdapter;
  enqueueExtraction?: EnqueueExtraction;
  logger?: BackgroundJobQueueLogger;
}): Promise<EnqueueAndPublishExtractionJobResult> {
  const mode =
    input.runtimeMode ??
    resolveExtractionRuntimeMode({
      configured: process.env.TENDNOTE_EXTRACTION_RUNTIME,
      nodeEnv: process.env.NODE_ENV,
    });
  const result = await (input.enqueueExtraction ?? enqueueAndTriggerExtractionJob)({
    sourceRecordId: input.sourceRecordId,
    runtimeMode: mode,
  });

  if (mode === "inline") {
    return { ...result, deliveryId: null, publishResult: null };
  }

  const deliveryStore = input.deliveryStore ?? createDrizzleBackgroundJobDeliveryStore();
  const { delivery } = await deliveryStore.createBackgroundJobDelivery({
    ownerUserId: input.ownerUserId,
    jobKind: "extraction",
    jobId: result.job.id,
  });
  const publishResult = await publishBackgroundJobDelivery({
    store: deliveryStore,
    queue: input.queue ?? createVercelBackgroundJobQueueAdapter(),
    ownerUserId: input.ownerUserId,
    deliveryId: delivery.id,
    logger: input.logger,
  });

  return { ...result, deliveryId: delivery.id, publishResult };
}

export type EnqueueAndPublishActionExtractionJobResult =
  EnqueueAndTriggerActionExtractionJobResult & {
    deliveryId: string | null;
    publishResult: Awaited<ReturnType<typeof publishBackgroundJobDelivery>> | null;
  };

type EnqueueActionExtraction = (
  input: EnqueueAndTriggerActionExtractionJobInput,
) => Promise<EnqueueAndTriggerActionExtractionJobResult>;

/**
 * Action-extraction twin of {@link enqueueAndPublishExtractionJob} (ADR-0151): enqueue a
 * Suggested General Action extraction job, and in enqueue_only mode publish its outbox
 * delivery under the `action_extraction` job kind. It rides the shared extraction topic
 * and consumer route, dispatched by job kind, so no new Vercel queue is required.
 */
export async function enqueueAndPublishActionExtractionJob(input: {
  ownerUserId: string;
  sourceRecordId: string;
  runtimeMode?: EnqueueAndTriggerActionExtractionJobInput["runtimeMode"];
  deliveryStore?: BackgroundJobDeliveryStore;
  queue?: BackgroundJobQueueSendAdapter;
  enqueueActionExtraction?: EnqueueActionExtraction;
  logger?: BackgroundJobQueueLogger;
}): Promise<EnqueueAndPublishActionExtractionJobResult> {
  const mode =
    input.runtimeMode ??
    resolveExtractionRuntimeMode({
      configured: process.env.TENDNOTE_EXTRACTION_RUNTIME,
      nodeEnv: process.env.NODE_ENV,
    });
  const result = await (input.enqueueActionExtraction ?? enqueueAndTriggerActionExtractionJob)({
    sourceRecordId: input.sourceRecordId,
    runtimeMode: mode,
  });

  if (mode === "inline") {
    return { ...result, deliveryId: null, publishResult: null };
  }

  const deliveryStore = input.deliveryStore ?? createDrizzleBackgroundJobDeliveryStore();
  const { delivery } = await deliveryStore.createBackgroundJobDelivery({
    ownerUserId: input.ownerUserId,
    jobKind: "action_extraction",
    jobId: result.job.id,
  });
  const publishResult = await publishBackgroundJobDelivery({
    store: deliveryStore,
    queue: input.queue ?? createVercelBackgroundJobQueueAdapter(),
    ownerUserId: input.ownerUserId,
    deliveryId: delivery.id,
    logger: input.logger,
  });

  return { ...result, deliveryId: delivery.id, publishResult };
}

export async function consumeExtractionQueueMessage(input: {
  payload: unknown;
  metadata?: BackgroundJobQueueConsumerMetadata;
  deliveryStore?: BackgroundJobDeliveryStore;
  logger?: BackgroundJobQueueLogger;
  now?: Date;
  rateLimiter?: ProductRateLimiter;
  claimJob?: typeof claimExtractionJob;
  getJob?: typeof getExtractionJob;
  processJob?: typeof processExtractionJob;
  claimActionJob?: typeof claimActionExtractionJob;
  getActionJob?: typeof getActionExtractionJob;
  processActionJob?: typeof processActionExtractionJob;
}) {
  const deliveryStore = input.deliveryStore ?? createDrizzleBackgroundJobDeliveryStore();
  const claimJob = input.claimJob ?? claimExtractionJob;
  const getJob = input.getJob ?? getExtractionJob;
  const processJob = input.processJob ?? processExtractionJob;
  const claimActionJob = input.claimActionJob ?? claimActionExtractionJob;
  const getActionJob = input.getActionJob ?? getActionExtractionJob;
  const processActionJob = input.processActionJob ?? processActionExtractionJob;

  return consumeBackgroundJobQueueMessage({
    store: deliveryStore,
    payload: input.payload,
    metadata: input.metadata,
    logger: input.logger,
    rateLimiter: input.rateLimiter,
    // One route consumes the shared extraction topic; the runtime dispatches each message
    // to the processor matching its job kind, so memory and action extraction stay
    // independent while sharing transport.
    processors: [
      {
        jobKind: "extraction",
        async claimJob({ jobId }) {
          const claimed = await claimJob({ jobId, now: input.now });
          if (claimed) {
            return { status: "ready" as const };
          }

          const job = await getJob(jobId);
          if (!job) {
            return { status: "not_found" as const, reason: "Extraction job not found." };
          }
          if (job.status === "completed" || job.status === "skipped") {
            return { status: "terminal" as const, reason: `Extraction job is ${job.status}.` };
          }

          return {
            status: "not_claimable" as const,
            reason: `Extraction job is ${job.status}.`,
          };
        },
        async processJob({ jobId }) {
          const result = await processJob({ jobId, claim: false });
          if (result.outcome === "failed") {
            throw new Error(result.error ?? result.reason ?? "Extraction job failed.");
          }
        },
      },
      {
        jobKind: "action_extraction",
        async claimJob({ jobId }) {
          const claimed = await claimActionJob({ jobId, now: input.now });
          if (claimed) {
            return { status: "ready" as const };
          }

          const job = await getActionJob(jobId);
          if (!job) {
            return { status: "not_found" as const, reason: "Action extraction job not found." };
          }
          if (job.status === "completed" || job.status === "skipped") {
            return {
              status: "terminal" as const,
              reason: `Action extraction job is ${job.status}.`,
            };
          }

          return {
            status: "not_claimable" as const,
            reason: `Action extraction job is ${job.status}.`,
          };
        },
        async processJob({ jobId }) {
          const result = await processActionJob({ jobId, claim: false });
          if (result.outcome === "failed") {
            throw new Error(result.error ?? result.reason ?? "Action extraction job failed.");
          }
        },
      },
    ],
  });
}
