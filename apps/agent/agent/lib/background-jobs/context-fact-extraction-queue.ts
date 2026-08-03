import type {
  BackgroundJobDeliveryStore,
  BackgroundJobQueueSendAdapter,
} from "@tendnote/db/queries/background-job-deliveries";
import {
  BACKGROUND_JOB_FAMILIES,
  enqueueAndPublishBackgroundJob,
} from "@tendnote/db/queries/background-jobs";
import type {
  EnqueueAndTriggerContextFactExtractionJobInput,
  EnqueueAndTriggerContextFactExtractionJobResult,
} from "@tendnote/db/queries/context-fact-extraction-jobs";
import { createVercelBackgroundJobQueueAdapter } from "./queue-adapter";

type EnqueueContextFactExtraction = (
  input: EnqueueAndTriggerContextFactExtractionJobInput,
) => Promise<EnqueueAndTriggerContextFactExtractionJobResult>;

export async function enqueueAndPublishContextFactExtractionJob(input: {
  ownerUserId: string;
  message: string;
  idempotencyKey: string;
  runtimeMode?: EnqueueAndTriggerContextFactExtractionJobInput["runtimeMode"];
  deliveryStore?: BackgroundJobDeliveryStore;
  queue?: BackgroundJobQueueSendAdapter;
  enqueueContextFactExtraction?: EnqueueContextFactExtraction;
}): Promise<EnqueueAndTriggerContextFactExtractionJobResult & { deliveryId: string | null }> {
  const { publishResult, ...result } = await enqueueAndPublishBackgroundJob(
    BACKGROUND_JOB_FAMILIES.context_fact_extraction,
    {
      ownerUserId: input.ownerUserId,
      enqueueInput: {
        ownerUserId: input.ownerUserId,
        message: input.message,
        idempotencyKey: input.idempotencyKey,
      },
      runtimeMode: input.runtimeMode,
      deliveryStore: input.deliveryStore,
      queue: input.queue ?? createVercelBackgroundJobQueueAdapter(),
      enqueue: input.enqueueContextFactExtraction,
    },
  );
  return result;
}
