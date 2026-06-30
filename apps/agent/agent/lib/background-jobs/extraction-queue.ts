import {
  type BackgroundJobDeliveryStore,
  type BackgroundJobQueueSendAdapter,
  createDrizzleBackgroundJobDeliveryStore,
  publishBackgroundJobDelivery,
} from "@tendnote/db/queries/background-job-deliveries";
import {
  type EnqueueAndTriggerExtractionJobInput,
  type EnqueueAndTriggerExtractionJobResult,
  enqueueAndTriggerExtractionJob,
  resolveExtractionRuntimeMode,
} from "@tendnote/db/queries/extraction-jobs";
import { createVercelBackgroundJobQueueAdapter } from "./queue-adapter";

type EnqueueExtraction = (
  input: EnqueueAndTriggerExtractionJobInput,
) => Promise<EnqueueAndTriggerExtractionJobResult>;

/**
 * Enqueue a suggested-memory extraction job and, in enqueue_only mode, publish its
 * outbox delivery through the shared @tendnote/db publish orchestration (ADR-0068).
 * Eve and the web go through the same publish path now; only the concrete Vercel
 * transport is injected per app.
 */
export async function enqueueAndPublishExtractionJob(input: {
  ownerUserId: string;
  sourceRecordId: string;
  runtimeMode?: EnqueueAndTriggerExtractionJobInput["runtimeMode"];
  deliveryStore?: BackgroundJobDeliveryStore;
  queue?: BackgroundJobQueueSendAdapter;
  enqueueExtraction?: EnqueueExtraction;
}): Promise<EnqueueAndTriggerExtractionJobResult & { deliveryId: string | null }> {
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
    return { ...result, deliveryId: null };
  }

  const deliveryStore = input.deliveryStore ?? createDrizzleBackgroundJobDeliveryStore();
  const { delivery } = await deliveryStore.createBackgroundJobDelivery({
    ownerUserId: input.ownerUserId,
    jobKind: "extraction",
    jobId: result.job.id,
  });
  await publishBackgroundJobDelivery({
    store: deliveryStore,
    queue: input.queue ?? createVercelBackgroundJobQueueAdapter(),
    ownerUserId: input.ownerUserId,
    deliveryId: delivery.id,
  });

  return { ...result, deliveryId: delivery.id };
}
