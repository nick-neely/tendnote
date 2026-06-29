import {
  type BackgroundJobDeliveryStore,
  createDrizzleBackgroundJobDeliveryStore,
} from "@tendnote/db/queries/background-job-deliveries";
import {
  type EnqueueAndTriggerSemanticEmbeddingJobInput,
  type EnqueueAndTriggerSemanticEmbeddingJobResult,
  enqueueAndTriggerSemanticEmbeddingJob,
  resolveSemanticEmbeddingRuntimeMode,
} from "@tendnote/db/queries/semantic-retrieval";
import { send as sendVercelQueueMessage } from "@vercel/queue";

type QueueSendAdapter = {
  send: (input: {
    topic: string;
    payload: { deliveryId: string; jobKind: "embedding"; jobId: string };
    idempotencyKey: string;
    headers?: Record<string, string>;
  }) => Promise<unknown>;
};

type EnqueueEmbedding = (
  input: EnqueueAndTriggerSemanticEmbeddingJobInput,
) => Promise<EnqueueAndTriggerSemanticEmbeddingJobResult>;

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

export async function enqueueAndPublishSemanticEmbeddingJob(input: {
  ownerUserId: string;
  recordKind: EnqueueAndTriggerSemanticEmbeddingJobInput["recordKind"];
  recordId: string;
  runtimeMode?: EnqueueAndTriggerSemanticEmbeddingJobInput["runtimeMode"];
  deliveryStore?: BackgroundJobDeliveryStore;
  queue?: QueueSendAdapter;
  enqueueEmbedding?: EnqueueEmbedding;
}): Promise<EnqueueAndTriggerSemanticEmbeddingJobResult & { deliveryId: string | null }> {
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
    return { ...result, deliveryId: null };
  }

  const deliveryStore = input.deliveryStore ?? createDrizzleBackgroundJobDeliveryStore();
  const { delivery } = await deliveryStore.createBackgroundJobDelivery({
    ownerUserId: input.ownerUserId,
    jobKind: "embedding",
    jobId: result.job.id,
  });

  try {
    await (input.queue ?? createVercelQueueAdapter()).send({
      topic: delivery.topic,
      payload: { deliveryId: delivery.id, jobKind: "embedding", jobId: delivery.jobId },
      idempotencyKey: `embedding:${delivery.jobId}:${delivery.topic}:${delivery.id}`,
      headers: {
        "x-tendnote-job-kind": "embedding",
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
