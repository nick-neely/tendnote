import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../client";
import { backgroundJobDeliveries, reminderDeliveryJobs } from "../../schema";
import type {
  BackgroundJobDelivery,
  BackgroundJobDeliveryStore,
  BackgroundJobQueueLogger,
  BackgroundJobQueueSendAdapter,
} from "../background-job-deliveries";
import { suppressReminderDelivery } from "./dispatch";
import { armReminderDelivery } from "./outbox";
import { REMINDER_DELIVERY_LEASE_MS, reminderDeliveryWakeupTime } from "./policy";
import type { ReminderStore } from "./types";

/**
 * How long past its due time a job may wait before recovery treats its
 * wake-up as lost. Longer than queue lag and one consumer retry, so a pointer
 * that is merely on its way is not replaced; shorter than one recovery
 * interval, so a lost one is found on the next pass.
 */
export const REMINDER_LOST_WAKEUP_GRACE_MS = 5 * 60_000;

type WakeupDependencies = {
  reminderStore: Pick<ReminderStore, "getDeliveryJob">;
  deliveryStore: BackgroundJobDeliveryStore;
  queue: BackgroundJobQueueSendAdapter;
  now: Date;
  /**
   * Off (`REMINDER_DELIVERY_PUBLISH_AHEAD=off`) leaves the re-armed revision
   * for the recovery cron to publish when due instead of sending it now.
   */
  publishAhead?: boolean;
  logger?: BackgroundJobQueueLogger;
};

/**
 * Arms the next wake-up for a job from its current authoritative state.
 *
 * Used where a pointer arrived and found nothing to do yet - a checkpoint hop
 * short of a far-future alert, an early callback, a retry not yet due - and by
 * recovery for a pointer that never arrived. The job is reloaded here rather
 * than trusted from the message, so the wake-up follows the latest edit, and a
 * job that has since completed, been skipped or been deleted gets none.
 */
export async function rearmReminderDeliveryJob(
  input: WakeupDependencies & { jobId: string },
): Promise<BackgroundJobDelivery | null> {
  const job = await input.reminderStore.getDeliveryJob(input.jobId);
  const deliverAt = reminderDeliveryWakeupTime(job, input.now);
  if (!job || !deliverAt) return null;
  return armReminderDelivery({
    store: input.deliveryStore,
    queue: input.queue,
    ownerUserId: job.ownerUserId,
    jobId: job.id,
    deliverAt,
    now: input.now,
    publishAhead: input.publishAhead,
    logger: input.logger,
  });
}

export type LostReminderWakeupResult = {
  scanned: number;
  rearmed: number;
  /** Overdue jobs whose freshness had passed, closed as stale without a wake-up. */
  expired: number;
  failed: number;
};

/**
 * Whether a delivery row shows a wake-up that should have fired by now.
 *
 * A pending or failed publication is the ordinary outbox recovery's to retry,
 * and a pointer published within the grace may still be on its way. A
 * published pointer older than that, an abandoned row, or no row at all means
 * the queue holds nothing that will wake this job.
 */
function wakeupLost(delivery: BackgroundJobDelivery | null, now: Date): boolean {
  if (!delivery) return true;
  if (delivery.status === "pending" || delivery.status === "publish_failed") return false;
  if (delivery.status === "abandoned") return true;
  const publishedAt = delivery.publishedAt?.getTime() ?? 0;
  return publishedAt <= now.getTime() - REMINDER_LOST_WAKEUP_GRACE_MS;
}

/**
 * The safety net for wake-ups the queue will never deliver.
 *
 * A delayed pointer can still be lost: it may expire during a hold longer than
 * its retention, the provider may drop it in an outage, a process may crash
 * between commit and send, a callback may time out mid-dispatch, or a rollback
 * may leave rows the old code published differently. Postgres still knows the
 * job is owed a delivery, so each recovery pass re-arms the oldest overdue
 * ones. Dispatch then decides afresh, which for a reminder whose freshness has
 * passed means suppressing that one stale alert and nothing else.
 */
export async function recoverLostReminderWakeups(
  input: Omit<WakeupDependencies, "reminderStore"> & {
    reminderStore: Pick<
      ReminderStore,
      "getDeliveryJob" | "listOverdueDeliveryJobs" | "updateDeliveryJob" | "appendAuditEntry"
    >;
    limit: number;
  },
): Promise<LostReminderWakeupResult> {
  const result: LostReminderWakeupResult = { scanned: 0, rearmed: 0, expired: 0, failed: 0 };
  if (input.limit <= 0) return result;
  const jobs = await input.reminderStore.listOverdueDeliveryJobs({
    dueBefore: new Date(input.now.getTime() - REMINDER_LOST_WAKEUP_GRACE_MS),
    leaseExpiredBefore: new Date(input.now.getTime() - REMINDER_DELIVERY_LEASE_MS),
    limit: input.limit,
  });
  for (const job of jobs) {
    result.scanned += 1;
    const delivery = await input.deliveryStore.findBackgroundJobDeliveryForJob({
      ownerUserId: job.ownerUserId,
      jobKind: "reminder_push",
      jobId: job.id,
    });
    if (!wakeupLost(delivery, input.now)) continue;
    // Past its freshness, the only outcome left is suppressing the stale
    // alert, so it is decided here rather than by another wake-up. This is
    // also what bounds a job whose dispatch keeps failing: it is re-armed
    // only until its freshness ends, never forever.
    if (job.freshUntil.getTime() <= input.now.getTime()) {
      await suppressReminderDelivery(input.reminderStore, job, input.now, "suppressed_stale");
      result.expired += 1;
      continue;
    }
    const rearmed = await rearmReminderDeliveryJob({ ...input, jobId: job.id });
    if (rearmed?.status === "publish_failed") result.failed += 1;
    else if (rearmed) result.rearmed += 1;
  }
  if (result.rearmed || result.expired || result.failed) {
    input.logger?.info?.("reminder_delivery.lost_wakeups_rearmed", {
      scanned: result.scanned,
      rearmed: result.rearmed,
      expired: result.expired,
      failed: result.failed,
    });
  }
  return result;
}

/**
 * Returns every live reminder delivery to the cron-only contract the code
 * before ADR 0267 relies on: pending, unrevised, and due for publication at
 * the job's own next attempt time.
 *
 * Run once, after setting `REMINDER_DELIVERY_PUBLISH_AHEAD=off` and before
 * deploying code that predates delayed wake-ups. That code publishes only
 * pending rows that are due and drops a pointer that arrives early, so a row
 * left `published` behind a checkpoint, or `pending` at the time it was armed,
 * would never be delivered by it. Pointers already in the queue then meet a
 * pending row and are dropped harmlessly while the cron publishes each job when
 * due. The revision is kept, so a later roll-forward never reuses a key the
 * provider may still be deduplicating; pointers older code published then
 * carry no revision and no-op, and the lost-wake-up sweep re-arms those jobs.
 */
export async function resetReminderDeliveriesToCronOnly(): Promise<{ reset: number }> {
  const awaiting = getDb()
    .select({ id: reminderDeliveryJobs.id })
    .from(reminderDeliveryJobs)
    .where(inArray(reminderDeliveryJobs.status, ["pending", "failed", "running"]));
  const rows = await getDb()
    .update(backgroundJobDeliveries)
    .set({
      status: "pending",
      publishedAt: null,
      lastError: null,
      nextAttemptAt: sql`(select ${reminderDeliveryJobs.nextAttemptAt} from ${reminderDeliveryJobs} where ${reminderDeliveryJobs.id} = ${backgroundJobDeliveries.jobId})`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(backgroundJobDeliveries.jobKind, "reminder_push"),
        inArray(backgroundJobDeliveries.jobId, awaiting),
      ),
    )
    .returning({ id: backgroundJobDeliveries.id });
  return { reset: rows.length };
}
