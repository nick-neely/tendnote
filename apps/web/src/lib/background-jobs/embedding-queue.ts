import {
  type BackgroundJobDeliveryStore,
  createDrizzleBackgroundJobDeliveryStore,
} from "@tendnote/db/queries/background-job-deliveries";
import {
  BACKGROUND_JOB_FAMILIES,
  type BackgroundJobProcessorOverrides,
  createBackgroundJobProcessor,
  type EnqueueAndPublishBackgroundJobResult,
  enqueueAndPublishBackgroundJob,
} from "@tendnote/db/queries/background-jobs";
import type {
  EnqueueAndTriggerSemanticEmbeddingJobInput,
  EnqueueAndTriggerSemanticEmbeddingJobResult,
} from "@tendnote/db/queries/semantic-retrieval";
import type { ProductRateLimiter } from "@/lib/rate-limit";
import {
  type BackgroundJobQueueConsumerMetadata,
  type BackgroundJobQueueLogger,
  type BackgroundJobQueueSendAdapter,
  consumeBackgroundJobQueueMessage,
  createVercelBackgroundJobQueueAdapter,
} from "./queue-runtime";

export type EnqueueAndPublishSemanticEmbeddingJobResult =
  EnqueueAndPublishBackgroundJobResult<EnqueueAndTriggerSemanticEmbeddingJobResult>;

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
  return enqueueAndPublishBackgroundJob(BACKGROUND_JOB_FAMILIES.embedding, {
    ownerUserId: input.ownerUserId,
    enqueueInput: {
      ownerUserId: input.ownerUserId,
      recordKind: input.recordKind,
      recordId: input.recordId,
    },
    runtimeMode: input.runtimeMode,
    deliveryStore: input.deliveryStore,
    queue: input.queue ?? createVercelBackgroundJobQueueAdapter(),
    enqueue: input.enqueueEmbedding,
    logger: input.logger,
  });
}

export async function consumeEmbeddingQueueMessage(input: {
  payload: unknown;
  metadata?: BackgroundJobQueueConsumerMetadata;
  deliveryStore?: BackgroundJobDeliveryStore;
  logger?: BackgroundJobQueueLogger;
  now?: Date;
  rateLimiter?: ProductRateLimiter;
  claimJob?: BackgroundJobProcessorOverrides["claimJob"];
  getJob?: BackgroundJobProcessorOverrides["getJob"];
  processJob?: BackgroundJobProcessorOverrides["processJob"];
}) {
  const deliveryStore = input.deliveryStore ?? createDrizzleBackgroundJobDeliveryStore();

  return consumeBackgroundJobQueueMessage({
    store: deliveryStore,
    payload: input.payload,
    metadata: input.metadata,
    logger: input.logger,
    rateLimiter: input.rateLimiter,
    processors: [
      createBackgroundJobProcessor(BACKGROUND_JOB_FAMILIES.embedding, {
        now: input.now,
        claimJob: input.claimJob,
        getJob: input.getJob,
        processJob: input.processJob,
      }),
    ],
  });
}
