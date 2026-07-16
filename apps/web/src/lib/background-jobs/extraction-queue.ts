import type {
  EnqueueAndTriggerActionExtractionJobInput,
  EnqueueAndTriggerActionExtractionJobResult,
} from "@tendnote/db/queries/action-extraction-jobs";
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
  EnqueueAndTriggerExtractionJobInput,
  EnqueueAndTriggerExtractionJobResult,
} from "@tendnote/db/queries/extraction-jobs";
import type { ProductRateLimiter } from "@/lib/rate-limit";
import {
  type BackgroundJobQueueConsumerMetadata,
  type BackgroundJobQueueLogger,
  type BackgroundJobQueueSendAdapter,
  consumeBackgroundJobQueueMessage,
  createVercelBackgroundJobQueueAdapter,
} from "./queue-runtime";

export type EnqueueAndPublishExtractionJobResult =
  EnqueueAndPublishBackgroundJobResult<EnqueueAndTriggerExtractionJobResult>;

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
  return enqueueAndPublishBackgroundJob(BACKGROUND_JOB_FAMILIES.extraction, {
    ownerUserId: input.ownerUserId,
    enqueueInput: { sourceRecordId: input.sourceRecordId },
    runtimeMode: input.runtimeMode,
    deliveryStore: input.deliveryStore,
    queue: input.queue ?? createVercelBackgroundJobQueueAdapter(),
    enqueue: input.enqueueExtraction,
    logger: input.logger,
  });
}

export type EnqueueAndPublishActionExtractionJobResult =
  EnqueueAndPublishBackgroundJobResult<EnqueueAndTriggerActionExtractionJobResult>;

type EnqueueActionExtraction = (
  input: EnqueueAndTriggerActionExtractionJobInput,
) => Promise<EnqueueAndTriggerActionExtractionJobResult>;

/**
 * Action-extraction twin of {@link enqueueAndPublishExtractionJob} (ADR-0151): enqueue a
 * Suggested General Action extraction job, and in enqueue_only mode publish its outbox
 * delivery under the `action_extraction` job kind. It rides the shared extraction topic
 * and consumer route, dispatched by job kind, so no new Vercel queue is required. Both run
 * through the shared {@link enqueueAndPublishBackgroundJob} path.
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
  return enqueueAndPublishBackgroundJob(BACKGROUND_JOB_FAMILIES.action_extraction, {
    ownerUserId: input.ownerUserId,
    enqueueInput: { sourceRecordId: input.sourceRecordId },
    runtimeMode: input.runtimeMode,
    deliveryStore: input.deliveryStore,
    queue: input.queue ?? createVercelBackgroundJobQueueAdapter(),
    enqueue: input.enqueueActionExtraction,
    logger: input.logger,
  });
}

export async function consumeExtractionQueueMessage(input: {
  payload: unknown;
  metadata?: BackgroundJobQueueConsumerMetadata;
  deliveryStore?: BackgroundJobDeliveryStore;
  logger?: BackgroundJobQueueLogger;
  now?: Date;
  rateLimiter?: ProductRateLimiter;
  claimJob?: BackgroundJobProcessorOverrides["claimJob"];
  getJob?: BackgroundJobProcessorOverrides["getJob"];
  processJob?: BackgroundJobProcessorOverrides["processJob"];
  claimActionJob?: BackgroundJobProcessorOverrides["claimJob"];
  getActionJob?: BackgroundJobProcessorOverrides["getJob"];
  processActionJob?: BackgroundJobProcessorOverrides["processJob"];
}) {
  const deliveryStore = input.deliveryStore ?? createDrizzleBackgroundJobDeliveryStore();

  return consumeBackgroundJobQueueMessage({
    store: deliveryStore,
    payload: input.payload,
    metadata: input.metadata,
    logger: input.logger,
    rateLimiter: input.rateLimiter,
    // One route consumes the shared extraction topic; the runtime dispatches each message
    // to the processor matching its job kind, so memory and action extraction stay
    // independent while sharing transport and the same claim-translation mechanics.
    processors: [
      createBackgroundJobProcessor(BACKGROUND_JOB_FAMILIES.extraction, {
        now: input.now,
        claimJob: input.claimJob,
        getJob: input.getJob,
        processJob: input.processJob,
      }),
      createBackgroundJobProcessor(BACKGROUND_JOB_FAMILIES.action_extraction, {
        now: input.now,
        claimJob: input.claimActionJob,
        getJob: input.getActionJob,
        processJob: input.processActionJob,
      }),
    ],
  });
}
