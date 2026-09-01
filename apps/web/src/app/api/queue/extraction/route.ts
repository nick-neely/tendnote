import { consumeExtractionQueueMessage } from "@/lib/background-jobs/extraction-queue";
import {
  BACKGROUND_JOB_QUEUE_CONFIG,
  createBackgroundJobQueueCallback,
} from "@/lib/background-jobs/queue-runtime";

// The shared callback authenticates the message (HMAC signature) before any consumer
// logic or DB access runs, then defers rate-limited messages back to the queue.
const handleExtractionQueueCallback = createBackgroundJobQueueCallback({
  config: BACKGROUND_JOB_QUEUE_CONFIG.extraction,
  consume: consumeExtractionQueueMessage,
  deferredMessage: (reason) => `Extraction delivery deferred: ${reason}`,
});

export function POST(request: Request) {
  return handleExtractionQueueCallback(request);
}
