import type { BackgroundJobDeliveryStore } from "../background-job-deliveries";

/**
 * Idempotently places a Reminder delivery job in the shared durable outbox. The
 * future `nextAttemptAt` is intentional: recovery publishes the queue message only
 * when the alert is due, while an edited schedule moves the same outbox row.
 */
export async function scheduleReminderDeliveryOutbox(
  store: BackgroundJobDeliveryStore,
  input: { ownerUserId: string; jobId: string; nextAttemptAt: Date },
) {
  const result = await store.createBackgroundJobDelivery({
    ownerUserId: input.ownerUserId,
    jobKind: "reminder_push",
    jobId: input.jobId,
    nextAttemptAt: input.nextAttemptAt,
  });
  if (result.delivery.nextAttemptAt.getTime() !== input.nextAttemptAt.getTime()) {
    return store.updateBackgroundJobDelivery({
      ownerUserId: input.ownerUserId,
      deliveryId: result.delivery.id,
      status: "pending",
      lastError: null,
      nextAttemptAt: input.nextAttemptAt,
      publishedAt: null,
    });
  }
  return result.delivery;
}
