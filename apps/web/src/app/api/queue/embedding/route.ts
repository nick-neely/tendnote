import { handleCallback } from "@vercel/queue";
import { consumeEmbeddingQueueMessage } from "@/lib/background-jobs/embedding-queue";
import { BACKGROUND_JOB_QUEUE_CONFIG } from "@/lib/background-jobs/queue-runtime";
import { getProductRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";

const handleEmbeddingQueueCallback = handleCallback(
  async (message, metadata) => {
    const result = await consumeEmbeddingQueueMessage({
      payload: message,
      metadata: {
        topicName: metadata.topicName,
        messageId: metadata.messageId,
        deliveryCount: metadata.deliveryCount,
        consumerGroup: metadata.consumerGroup,
      },
      logger: console,
      rateLimiter: getProductRateLimiter(),
    });

    // A rate-limited message is deferred, not failed: throwing asks the queue to
    // redeliver it later (afterSeconds below), leaving delivery/job status intact.
    if (result.status === "deferred") {
      throw new Error(`Embedding delivery deferred: ${result.reason}`);
    }
  },
  {
    visibilityTimeoutSeconds: BACKGROUND_JOB_QUEUE_CONFIG.embedding.visibilityTimeoutSeconds,
    retry() {
      return { afterSeconds: BACKGROUND_JOB_QUEUE_CONFIG.embedding.retryAfterSeconds };
    },
  },
);

export function POST(request: Request) {
  return handleEmbeddingQueueCallback(request);
}
