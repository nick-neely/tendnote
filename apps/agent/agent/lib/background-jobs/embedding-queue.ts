import type {
  BackgroundJobDeliveryStore,
  BackgroundJobQueueSendAdapter,
} from "@tendnote/db/queries/background-job-deliveries";
import {
  BACKGROUND_JOB_FAMILIES,
  enqueueAndPublishBackgroundJob,
} from "@tendnote/db/queries/background-jobs";
import type {
  EnqueueAndTriggerSemanticEmbeddingJobInput,
  EnqueueAndTriggerSemanticEmbeddingJobResult,
} from "@tendnote/db/queries/semantic-retrieval";
import { createVercelBackgroundJobQueueAdapter } from "./queue-adapter";

type EnqueueEmbedding = (
  input: EnqueueAndTriggerSemanticEmbeddingJobInput,
) => Promise<EnqueueAndTriggerSemanticEmbeddingJobResult>;

/**
 * Enqueue a semantic-embedding job and, in enqueue_only mode, publish its outbox
 * delivery through the shared @tendnote/db execution module (ADR-0068). Eve and the web go
 * through the same enqueue → publish path now; only the concrete Vercel transport is
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
  // Eve callers consume only the enqueue result + deliveryId; drop the shared path's
  // publishResult so this wrapper's surface stays exactly what it was before ADR-0068.
  const { publishResult, ...result } = await enqueueAndPublishBackgroundJob(
    BACKGROUND_JOB_FAMILIES.embedding,
    {
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
    },
  );
  return result;
}
