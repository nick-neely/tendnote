import { consumeEmbeddingQueueMessage } from "@/lib/background-jobs/embedding-queue";
import {
  BACKGROUND_JOB_QUEUE_CONFIG,
  createBackgroundJobQueueCallback,
} from "@/lib/background-jobs/queue-runtime";

// Route segment config must remain a statically analyzable literal for Next.js.
export const maxDuration = 300;

// The shared callback authenticates the message (HMAC signature) before any consumer
// logic or DB access runs, then defers rate-limited messages back to the queue.
const handleEmbeddingQueueCallback = createBackgroundJobQueueCallback({
  config: BACKGROUND_JOB_QUEUE_CONFIG.embedding,
  consume: consumeEmbeddingQueueMessage,
  deferredMessage: (reason) => `Embedding delivery deferred: ${reason}`,
});

export function POST(request: Request) {
  return handleEmbeddingQueueCallback(request);
}
