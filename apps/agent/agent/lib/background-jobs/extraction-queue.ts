import type {
  EnqueueAndTriggerActionExtractionJobInput,
  EnqueueAndTriggerActionExtractionJobResult,
} from "@tendnote/db/queries/action-extraction-jobs";
import type {
  BackgroundJobDeliveryStore,
  BackgroundJobQueueSendAdapter,
} from "@tendnote/db/queries/background-job-deliveries";
import {
  BACKGROUND_JOB_FAMILIES,
  enqueueAndPublishBackgroundJob,
} from "@tendnote/db/queries/background-jobs";
import type {
  EnqueueAndTriggerExtractionJobInput,
  EnqueueAndTriggerExtractionJobResult,
} from "@tendnote/db/queries/extraction-jobs";
import { createVercelBackgroundJobQueueAdapter } from "./queue-adapter";

type EnqueueExtraction = (
  input: EnqueueAndTriggerExtractionJobInput,
) => Promise<EnqueueAndTriggerExtractionJobResult>;

/**
 * Enqueue a suggested-memory extraction job and, in enqueue_only mode, publish its outbox
 * delivery through the shared @tendnote/db execution module (ADR-0068). Eve and the web go
 * through the same enqueue → publish path now; only the concrete Vercel transport is
 * injected per app.
 */
export async function enqueueAndPublishExtractionJob(input: {
  ownerUserId: string;
  sourceRecordId: string;
  runtimeMode?: EnqueueAndTriggerExtractionJobInput["runtimeMode"];
  deliveryStore?: BackgroundJobDeliveryStore;
  queue?: BackgroundJobQueueSendAdapter;
  enqueueExtraction?: EnqueueExtraction;
}): Promise<EnqueueAndTriggerExtractionJobResult & { deliveryId: string | null }> {
  // Eve callers consume only the enqueue result + deliveryId; drop the shared path's
  // publishResult so this wrapper's surface stays exactly what it was before ADR-0068.
  const { publishResult, ...result } = await enqueueAndPublishBackgroundJob(
    BACKGROUND_JOB_FAMILIES.extraction,
    {
      ownerUserId: input.ownerUserId,
      enqueueInput: { sourceRecordId: input.sourceRecordId },
      runtimeMode: input.runtimeMode,
      deliveryStore: input.deliveryStore,
      queue: input.queue ?? createVercelBackgroundJobQueueAdapter(),
      enqueue: input.enqueueExtraction,
    },
  );
  return result;
}

type EnqueueActionExtraction = (
  input: EnqueueAndTriggerActionExtractionJobInput,
) => Promise<EnqueueAndTriggerActionExtractionJobResult>;

/**
 * Action-extraction twin of {@link enqueueAndPublishExtractionJob} (ADR-0151): enqueue a
 * Suggested General Action extraction job and, in enqueue_only mode, publish its outbox
 * delivery through the same shared execution module (ADR-0068). It rides the same
 * extraction topic and consumer route under the `action_extraction` job kind, so no new
 * Vercel queue is needed — the consumer dispatches by job kind.
 */
export async function enqueueAndPublishActionExtractionJob(input: {
  ownerUserId: string;
  sourceRecordId: string;
  runtimeMode?: EnqueueAndTriggerActionExtractionJobInput["runtimeMode"];
  deliveryStore?: BackgroundJobDeliveryStore;
  queue?: BackgroundJobQueueSendAdapter;
  enqueueActionExtraction?: EnqueueActionExtraction;
}): Promise<EnqueueAndTriggerActionExtractionJobResult & { deliveryId: string | null }> {
  const { publishResult, ...result } = await enqueueAndPublishBackgroundJob(
    BACKGROUND_JOB_FAMILIES.action_extraction,
    {
      ownerUserId: input.ownerUserId,
      enqueueInput: { sourceRecordId: input.sourceRecordId },
      runtimeMode: input.runtimeMode,
      deliveryStore: input.deliveryStore,
      queue: input.queue ?? createVercelBackgroundJobQueueAdapter(),
      enqueue: input.enqueueActionExtraction,
    },
  );
  return result;
}
