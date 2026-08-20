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
  EnqueueAndTriggerOwnerDataExportJobInput,
  EnqueueAndTriggerOwnerDataExportJobResult,
} from "@tendnote/db/queries/owner-data-export";
import type { ProductRateLimiter } from "@/lib/rate-limit";
import type {
  BackgroundJobQueueConsumerMetadata,
  BackgroundJobQueueLogger,
  BackgroundJobQueueSendAdapter,
} from "./queue-runtime";
import {
  consumeBackgroundJobQueueMessage,
  createVercelBackgroundJobQueueAdapter,
} from "./queue-runtime";

export type EnqueueAndPublishOwnerDataExportJobResult =
  EnqueueAndPublishBackgroundJobResult<EnqueueAndTriggerOwnerDataExportJobResult>;

type EnqueueOwnerDataExport = (
  input: EnqueueAndTriggerOwnerDataExportJobInput,
) => Promise<EnqueueAndTriggerOwnerDataExportJobResult>;

export async function enqueueAndPublishOwnerDataExportJob(input: {
  ownerUserId: string;
  idempotencyKey?: string;
  runtimeMode?: EnqueueAndTriggerOwnerDataExportJobInput["runtimeMode"];
  deliveryStore?: BackgroundJobDeliveryStore;
  queue?: BackgroundJobQueueSendAdapter;
  enqueueOwnerDataExport?: EnqueueOwnerDataExport;
  logger?: BackgroundJobQueueLogger;
}): Promise<EnqueueAndPublishOwnerDataExportJobResult> {
  return enqueueAndPublishBackgroundJob(BACKGROUND_JOB_FAMILIES.owner_data_export, {
    ownerUserId: input.ownerUserId,
    enqueueInput: {
      ownerUserId: input.ownerUserId,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    },
    runtimeMode: input.runtimeMode,
    deliveryStore: input.deliveryStore,
    queue: input.queue ?? createVercelBackgroundJobQueueAdapter(),
    enqueue: input.enqueueOwnerDataExport,
    logger: input.logger,
  });
}

export async function consumeOwnerDataExportQueueMessage(input: {
  payload: unknown;
  metadata?: BackgroundJobQueueConsumerMetadata;
  deliveryStore?: BackgroundJobDeliveryStore;
  logger?: BackgroundJobQueueLogger;
  rateLimiter?: ProductRateLimiter;
  now?: Date;
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
      createBackgroundJobProcessor(BACKGROUND_JOB_FAMILIES.owner_data_export, {
        now: input.now,
        claimJob: input.claimJob,
        getJob: input.getJob,
        processJob: input.processJob,
      }),
    ],
  });
}
