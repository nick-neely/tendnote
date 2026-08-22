import {
  BACKGROUND_JOB_QUEUE_CONFIG,
  createBackgroundJobQueueCallback,
} from "@/lib/background-jobs/queue-runtime";
import { consumeReminderQueueMessage } from "@/lib/background-jobs/reminder-queue";

const handleReminderQueueCallback = createBackgroundJobQueueCallback({
  config: BACKGROUND_JOB_QUEUE_CONFIG.reminder_push,
  consume: consumeReminderQueueMessage,
  deferredMessage: (reason) => `Reminder delivery deferred: ${reason}`,
});

export function POST(request: Request) {
  return handleReminderQueueCallback(request);
}
