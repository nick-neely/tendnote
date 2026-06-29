import { handleCallback } from "@vercel/queue";
import { consumeExtractionQueueMessage } from "@/lib/background-jobs/extraction-queue";
import { BACKGROUND_JOB_QUEUE_CONFIG } from "@/lib/background-jobs/queue-runtime";
import { getProductRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";

const handleExtractionQueueCallback = handleCallback(
  async (message, metadata) => {
    const result = await consumeExtractionQueueMessage({
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
      throw new Error(`Extraction delivery deferred: ${result.reason}`);
    }
  },
  {
    visibilityTimeoutSeconds: BACKGROUND_JOB_QUEUE_CONFIG.extraction.visibilityTimeoutSeconds,
    retry() {
      return { afterSeconds: BACKGROUND_JOB_QUEUE_CONFIG.extraction.retryAfterSeconds };
    },
  },
);

export function POST(request: Request) {
  return handleExtractionQueueCallback(request);
}
