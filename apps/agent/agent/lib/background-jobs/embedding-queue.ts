import {
  type BackgroundJobDeliveryStore,
  type BackgroundJobQueueSendAdapter,
  createDrizzleBackgroundJobDeliveryStore,
  publishBackgroundJobDelivery,
} from "@tendnote/db/queries/background-job-deliveries";
import {
  type EnqueueAndTriggerSemanticEmbeddingJobInput,
  type EnqueueAndTriggerSemanticEmbeddingJobResult,
  enqueueAndTriggerSemanticEmbeddingJob,
  resolveSemanticEmbeddingRuntimeMode,
} from "@tendnote/db/queries/semantic-retrieval";
import { createVercelBackgroundJobQueueAdapter } from "./queue-adapter";

type EnqueueEmbedding = (
  input: EnqueueAndTriggerSemanticEmbeddingJobInput,
) => Promise<EnqueueAndTriggerSemanticEmbeddingJobResult>;

/**
 * Enqueue a semantic-embedding job and, in enqueue_only mode, publish its outbox
 * delivery through the shared @tendnote/db publish orchestration (ADR-0068). Eve and
 * the web go through the same publish path now; only the concrete Vercel transport is
 * injected per app.
 */
export async function enqueueAndPublishSemanticEmbeddingJob(input: {
  ownerUserId: string;
  recordKind: EnqueueAndTriggerSemanticEmbeddingJobInput["recordKind"];
  recordId: string;
  runtimeMode?: EnqueueAndTriggerSemanticEmbeddingJobInput["runtimeMode"];
  deliveryStore?: BackgroundJobDeliveryStore;
  queue?: BackgroundJobQueueSendAdapter;
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
  await publishBackgroundJobDelivery({
    store: deliveryStore,
    queue: input.queue ?? createVercelBackgroundJobQueueAdapter(),
    ownerUserId: input.ownerUserId,
    deliveryId: delivery.id,
  });

  return { ...result, deliveryId: delivery.id };
}
