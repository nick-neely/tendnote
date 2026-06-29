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
}) {
  const deliveryStore = input.deliveryStore ?? createDrizzleBackgroundJobDeliveryStore();
  const claimJob = input.claimJob ?? claimExtractionJob;
  const getJob = input.getJob ?? getExtractionJob;
  const processJob = input.processJob ?? processExtractionJob;

  return consumeBackgroundJobQueueMessage({
    store: deliveryStore,
    payload: input.payload,
    metadata: input.metadata,
    logger: input.logger,
    rateLimiter: input.rateLimiter,
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
    ],
  });
}
