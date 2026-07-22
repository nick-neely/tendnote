import { handleCallback } from "@vercel/queue";
import { BACKGROUND_JOB_QUEUE_CONFIG } from "@/lib/background-jobs/queue-runtime";
import { consumeReminderQueueMessage } from "@/lib/background-jobs/reminder-queue";
import { getProductRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";

const config = BACKGROUND_JOB_QUEUE_CONFIG.reminder_push;
const handleReminderQueueCallback = handleCallback(
  async (message, metadata) => {
    const result = await consumeReminderQueueMessage({
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
      throw new Error(`Reminder delivery deferred: ${result.reason}`);
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
  return handleReminderQueueCallback(request);
}
