import { handleCallback } from "@vercel/queue";
import { consumeOwnerDataExportQueueMessage } from "@/lib/background-jobs/owner-data-export-queue";
import { BACKGROUND_JOB_QUEUE_CONFIG } from "@/lib/background-jobs/queue-runtime";
import { getProductRateLimiter } from "@/lib/rate-limit";

// Route segment config must remain a statically analyzable literal for Next.js.
export const maxDuration = 300;

const config = BACKGROUND_JOB_QUEUE_CONFIG.owner_data_export;
const handleOwnerDataExportQueueCallback = handleCallback(
  async (message, metadata) => {
    const result = await consumeOwnerDataExportQueueMessage({
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
    if (result.status === "deferred") {
      throw new Error(`Owner data export delivery deferred: ${result.reason}`);
    }
  },
  {
    visibilityTimeoutSeconds: config.visibilityTimeoutSeconds,
    retry() {
      return { afterSeconds: config.retryAfterSeconds };
    },
  },
);

export function POST(request: Request) {
  return handleOwnerDataExportQueueCallback(request);
}
