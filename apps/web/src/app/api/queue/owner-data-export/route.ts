import { consumeOwnerDataExportQueueMessage } from "@/lib/background-jobs/owner-data-export-queue";
import {
  BACKGROUND_JOB_QUEUE_CONFIG,
  createBackgroundJobQueueCallback,
} from "@/lib/background-jobs/queue-runtime";

// Route segment config must remain a statically analyzable literal for Next.js.
export const maxDuration = 300;

const handleOwnerDataExportQueueCallback = createBackgroundJobQueueCallback({
  config: BACKGROUND_JOB_QUEUE_CONFIG.owner_data_export,
  consume: consumeOwnerDataExportQueueMessage,
  deferredMessage: (reason) => `Owner data export delivery deferred: ${reason}`,
});

export function POST(request: Request) {
  return handleOwnerDataExportQueueCallback(request);
}
