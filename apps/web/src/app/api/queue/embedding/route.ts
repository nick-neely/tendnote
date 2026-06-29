import { handleCallback } from "@vercel/queue";
import { consumeEmbeddingQueueMessage } from "@/lib/background-jobs/embedding-queue";
import { BACKGROUND_JOB_QUEUE_CONFIG } from "@/lib/background-jobs/queue-runtime";

export const runtime = "nodejs";

export const POST = handleCallback(
  async (message, metadata) => {
    await consumeEmbeddingQueueMessage({
      payload: message,
      metadata: {
        topicName: metadata.topicName,
        messageId: metadata.messageId,
        deliveryCount: metadata.deliveryCount,
        consumerGroup: metadata.consumerGroup,
      },
      logger: console,
    });
  },
  {
    visibilityTimeoutSeconds: BACKGROUND_JOB_QUEUE_CONFIG.embedding.visibilityTimeoutSeconds,
    retry() {
      return { afterSeconds: BACKGROUND_JOB_QUEUE_CONFIG.embedding.retryAfterSeconds };
    },
  },
);
