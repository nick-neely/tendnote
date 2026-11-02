import { runAfterDatabaseCommit } from "../../client";
import {
  type BackgroundJobDelivery,
  type BackgroundJobDeliveryStore,
  type BackgroundJobQueueLogger,
  type BackgroundJobQueueSendAdapter,
  publishBackgroundJobDelivery,
} from "../background-job-deliveries";

/**
 * Starts a new revision of a Reminder delivery job's durable outbox row.
 *
 * Every call is a re-arm - a new job, an edit, a retry, a reinstall, a
 * checkpoint hop - so every call bumps the revision. That gives the pointer
 * published for it its own idempotency key and lets any older pointer still in
 * the queue recognise it has been superseded (ADR 0267).
 *
 * `nextAttemptAt` is when recovery should publish this revision if nothing
 * publishes it sooner: the alert time itself when publishing ahead is off,
 * which is the original cron-only behaviour.
 */
export async function scheduleReminderDeliveryOutbox(
  store: BackgroundJobDeliveryStore,
  input: { ownerUserId: string; jobId: string; nextAttemptAt: Date },
): Promise<BackgroundJobDelivery> {
  const { delivery } = await store.createBackgroundJobDelivery({
    ownerUserId: input.ownerUserId,
    jobKind: "reminder_push",
    jobId: input.jobId,
    nextAttemptAt: input.nextAttemptAt,
  });
  return store.reviseBackgroundJobDelivery({
    ownerUserId: input.ownerUserId,
    deliveryId: delivery.id,
    nextAttemptAt: input.nextAttemptAt,
  });
}

/**
 * Records a Reminder delivery's wake-up and, when it can, publishes it now as
 * a queue message delayed until `deliverAt`.
 *
 * The outbox row commits first; publication runs only after the surrounding
 * transaction commits, and its failure never reaches the caller. A send that
 * fails, or never happens because the process died or no transport is
 * registered, leaves a pending revision that the recovery cron publishes - so
 * the owner's mutation stands either way and no reminder is left without a
 * wake-up. Postgres stays authoritative: the pointer only wakes the consumer,
 * which reloads the job and decides again.
 */
export async function armReminderDelivery(input: {
  store: BackgroundJobDeliveryStore;
  queue?: BackgroundJobQueueSendAdapter;
  ownerUserId: string;
  jobId: string;
  /** When the job is next due; the consumer is woken then and not before. */
  deliverAt: Date;
  now?: Date;
  /** Off restores cron-only delivery: recovery publishes when the job is due. */
  publishAhead?: boolean;
  logger?: BackgroundJobQueueLogger;
}): Promise<BackgroundJobDelivery> {
  const publishAhead = input.publishAhead ?? true;
  const now = input.now ?? new Date();
  const delivery = await scheduleReminderDeliveryOutbox(input.store, {
    ownerUserId: input.ownerUserId,
    jobId: input.jobId,
    nextAttemptAt: publishAhead ? now : input.deliverAt,
  });
  const queue = input.queue;
  if (!publishAhead || !queue) return delivery;

  let published: BackgroundJobDelivery = delivery;
  await runAfterDatabaseCommit(async () => {
    try {
      const result = await publishBackgroundJobDelivery({
        store: input.store,
        queue,
        ownerUserId: input.ownerUserId,
        deliveryId: delivery.id,
        deliverAt: input.deliverAt,
        now: input.now ?? new Date(),
        logger: input.logger,
      });
      published = result.delivery;
    } catch {
      // Sent-or-not is now uncertain (the send may have been accepted before
      // the status write failed). The pending revision stays for recovery,
      // which republishes under the same key, so an accepted send is not
      // duplicated within the provider's deduplication window.
      input.logger?.warn?.("reminder_delivery.publish_left_for_recovery", {
        revision: delivery.revision,
      });
    }
  });
  return published;
}
