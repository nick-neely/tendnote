import {
  type BackgroundJobDeliveryStore,
  createDrizzleBackgroundJobDeliveryStore,
} from "@tendnote/db/queries/background-job-deliveries";
import {
  claimSemanticEmbeddingJob,
  type EnqueueAndTriggerSemanticEmbeddingJobInput,
  type EnqueueAndTriggerSemanticEmbeddingJobResult,
  enqueueAndTriggerSemanticEmbeddingJob,
  getSemanticEmbeddingJob,
  type ProcessEmbeddingJobResult,
  processSemanticEmbeddingJob,
  resolveSemanticEmbeddingRuntimeMode,
} from "@tendnote/db/queries/semantic-retrieval";
import {
  type BackgroundJobQueueConsumerMetadata,
  type BackgroundJobQueueLogger,
  type BackgroundJobQueueSendAdapter,
  consumeBackgroundJobQueueMessage,
  createVercelBackgroundJobQueueAdapter,
  publishBackgroundJobDelivery,
} from "./queue-runtime";

export type EnqueueAndPublishSemanticEmbeddingJobResult =
  EnqueueAndTriggerSemanticEmbeddingJobResult & {
    deliveryId: string | null;
    publishResult: Awaited<ReturnType<typeof publishBackgroundJobDelivery>> | null;
  };

type EnqueueEmbedding = (
  input: EnqueueAndTriggerSemanticEmbeddingJobInput,
) => Promise<EnqueueAndTriggerSemanticEmbeddingJobResult>;

export async function enqueueAndPublishSemanticEmbeddingJob(input: {
  ownerUserId: string;
  recordKind: EnqueueAndTriggerSemanticEmbeddingJobInput["recordKind"];
  recordId: string;
  runtimeMode?: EnqueueAndTriggerSemanticEmbeddingJobInput["runtimeMode"];
  deliveryStore?: BackgroundJobDeliveryStore;
  queue?: BackgroundJobQueueSendAdapter;
  enqueueEmbedding?: EnqueueEmbedding;
  logger?: BackgroundJobQueueLogger;
}): Promise<EnqueueAndPublishSemanticEmbeddingJobResult> {
  const mode =
    input.runtimeMode ??
    resolveSemanticEmbeddingRuntimeMode({
      configured: process.env.TENDNOTE_EMBEDDING_RUNTIME,
      nodeEnv: process.env.NODE_ENV,
    });
  const result = await (input.enqueueEmbedding ?? enqueueAndTriggerSemanticEmbeddingJob)({
    ownerUserId: input.ownerUserId,
    recordKind: input.recordKind,
    recordId: input.recordId,
    runtimeMode: mode,
  });

  if (mode === "inline") {
    return { ...result, deliveryId: null, publishResult: null };
  }

  const deliveryStore = input.deliveryStore ?? createDrizzleBackgroundJobDeliveryStore();
  const { delivery } = await deliveryStore.createBackgroundJobDelivery({
    ownerUserId: input.ownerUserId,
    jobKind: "embedding",
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

export async function consumeEmbeddingQueueMessage(input: {
  payload: unknown;
  metadata?: BackgroundJobQueueConsumerMetadata;
  deliveryStore?: BackgroundJobDeliveryStore;
  logger?: BackgroundJobQueueLogger;
  now?: Date;
  claimJob?: typeof claimSemanticEmbeddingJob;
  getJob?: typeof getSemanticEmbeddingJob;
  processJob?: typeof processSemanticEmbeddingJob;
}) {
  const deliveryStore = input.deliveryStore ?? createDrizzleBackgroundJobDeliveryStore();
  const claimJob = input.claimJob ?? claimSemanticEmbeddingJob;
  const getJob = input.getJob ?? getSemanticEmbeddingJob;
  const processJob = input.processJob ?? processSemanticEmbeddingJob;

  return consumeBackgroundJobQueueMessage({
    store: deliveryStore,
    payload: input.payload,
    metadata: input.metadata,
    logger: input.logger,
    processors: [
      {
        jobKind: "embedding",
        async claimJob({ jobId }) {
          const claimed = await claimJob({ jobId, now: input.now });
          if (claimed) {
            return { status: "ready" as const };
          }

          const job = await getJob(jobId);
          if (!job) {
            return { status: "not_found" as const, reason: "Embedding job not found." };
          }
          if (job.status === "completed" || job.status === "skipped") {
            return { status: "terminal" as const, reason: `Embedding job is ${job.status}.` };
          }

          return {
            status: "not_claimable" as const,
            reason: `Embedding job is ${job.status}.`,
          };
        },
        async processJob({ jobId }) {
          const result: ProcessEmbeddingJobResult = await processJob({ jobId, claim: false });
          if (result.outcome === "failed") {
            throw new Error(result.error ?? result.reason ?? "Embedding job failed.");
          }
        },
      },
    ],
  });
}
