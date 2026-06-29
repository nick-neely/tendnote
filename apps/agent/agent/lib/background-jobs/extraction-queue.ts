import {
  type BackgroundJobDeliveryStore,
  createDrizzleBackgroundJobDeliveryStore,
} from "@tendnote/db/queries/background-job-deliveries";
import {
  type EnqueueAndTriggerExtractionJobInput,
  type EnqueueAndTriggerExtractionJobResult,
  enqueueAndTriggerExtractionJob,
  resolveExtractionRuntimeMode,
} from "@tendnote/db/queries/extraction-jobs";
import { send as sendVercelQueueMessage } from "@vercel/queue";

type QueueSendAdapter = {
  send: (input: {
    topic: string;
    payload: { deliveryId: string; jobKind: "extraction"; jobId: string };
    idempotencyKey: string;
    headers?: Record<string, string>;
  }) => Promise<unknown>;
};

type EnqueueExtraction = (
  input: EnqueueAndTriggerExtractionJobInput,
) => Promise<EnqueueAndTriggerExtractionJobResult>;

function createVercelQueueAdapter(): QueueSendAdapter {
  return {
    async send(input) {
      return sendVercelQueueMessage(input.topic, input.payload, {
        idempotencyKey: input.idempotencyKey,
        headers: input.headers,
      });
    },
  };
}

export async function enqueueAndPublishExtractionJob(input: {
  ownerUserId: string;
  sourceRecordId: string;
  runtimeMode?: EnqueueAndTriggerExtractionJobInput["runtimeMode"];
  deliveryStore?: BackgroundJobDeliveryStore;
  queue?: QueueSendAdapter;
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

  try {
    await (input.queue ?? createVercelQueueAdapter()).send({
      topic: delivery.topic,
      payload: { deliveryId: delivery.id, jobKind: "extraction", jobId: delivery.jobId },
      idempotencyKey: `extraction:${delivery.jobId}:${delivery.topic}:${delivery.id}`,
      headers: {
        "x-tendnote-job-kind": "extraction",
        "x-tendnote-delivery-id": delivery.id,
      },
    });
    await deliveryStore.markBackgroundJobDeliveryPublished({
      ownerUserId: input.ownerUserId,
      deliveryId: delivery.id,
    });
  } catch (error) {
    await deliveryStore.markBackgroundJobDeliveryPublishFailed({
      ownerUserId: input.ownerUserId,
      deliveryId: delivery.id,
      error: error instanceof Error ? error.message : String(error),
      nextAttemptAt: new Date(Date.now() + 5 * 60 * 1000),
    });
  }

  return { ...result, deliveryId: delivery.id };
}
