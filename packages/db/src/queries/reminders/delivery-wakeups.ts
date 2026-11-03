import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb, withDatabaseTransaction } from "../../client";
import { backgroundJobDeliveries, reminderDeliveryJobs } from "../../schema";
import type {
  BackgroundJobDelivery,
  BackgroundJobDeliveryStore,
  BackgroundJobQueueLogger,
  BackgroundJobQueueSendAdapter,
} from "../background-job-deliveries";
import {
  firstPublishAttemptAt,
  publishArmedReminderDelivery,
  scheduleReminderDeliveryOutbox,
} from "./outbox";
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
  input: WakeupDependencies & {
    jobId: string;
    /**
     * The delivery revision read before this call reads the job. The re-arm
     * happens only if nothing has re-armed since, because a concurrent edit
     * re-arms from fresher state than the job this call is about to read.
     */
    observedRevision?: number;
  },
): Promise<BackgroundJobDelivery | null> {
  const job = await input.reminderStore.getDeliveryJob(input.jobId);
  const deliverAt = reminderDeliveryWakeupTime(job, input.now);
  if (!job || !deliverAt) return null;
  const arm = {
    store: input.deliveryStore,
    queue: input.queue,
    ownerUserId: job.ownerUserId,
    jobId: job.id,
    deliverAt,
    now: input.now,
    publishAhead: input.publishAhead,
    logger: input.logger,
  };
  const delivery = await scheduleReminderDeliveryOutbox(input.deliveryStore, {
    ownerUserId: job.ownerUserId,
    jobId: job.id,
    nextAttemptAt: firstPublishAttemptAt(arm),
    revision: input.observedRevision,
  });
  return delivery ? publishArmedReminderDelivery(arm, delivery) : null;
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
 * Closes one stale job, conditionally: an edit, claim or dispatch that landed
 * after the sweep listed it wins, and nothing is written or audited.
 */
async function suppressStaleJob(
  input: {
    reminderStore: Pick<ReminderStore, "suppressStaleDeliveryJob" | "appendAuditEntry">;
    now: Date;
  },
  jobId: string,
): Promise<boolean> {
  const suppressed = await input.reminderStore.suppressStaleDeliveryJob({
    jobId,
    now: input.now,
    leaseExpiredBefore: new Date(input.now.getTime() - REMINDER_DELIVERY_LEASE_MS),
  });
  if (!suppressed) return false;
  await input.reminderStore.appendAuditEntry({
    ownerUserId: suppressed.ownerUserId,
    action: "reminder.delivery_suppressed",
    entityId: suppressed.id,
    metadata: { outcome: "suppressed_stale", installationId: suppressed.installationId },
    createdAt: input.now,
  });
  return true;
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
      "getDeliveryJob" | "listOverdueDeliveryJobs" | "suppressStaleDeliveryJob" | "appendAuditEntry"
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
      if (await suppressStaleJob(input, job.id)) result.expired += 1;
      continue;
    }
    const rearmed = await rearmReminderDeliveryJob({
      ...input,
      jobId: job.id,
      observedRevision: delivery?.revision,
    });
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
 * Why the rollback reset may not run yet, or null when it may.
 *
 * The reset must see a quiet system: older code never reclaims a `running`
 * job, so a claim taken after the reset by a dispatch that then dies would be
 * stranded for good. A Service-Wide Hold stops every queue callback and cron
 * pass, and once it has been in force for one claim lease, every claim taken
 * before it has either finished or expired - and the reset releases the
 * expired ones. So the reset runs only inside a hold at least that old, and
 * the hold stays in force until the older code is deployed.
 */
export function reminderRollbackBlocker(hold: { placedAt: Date } | null, now: Date): string | null {
  if (!hold) {
    return "Place a Service-Wide Hold first (pnpm --filter @tendnote/web service-hold place <reason>).";
  }
  const readyAt = new Date(hold.placedAt.getTime() + REMINDER_DELIVERY_LEASE_MS);
  return now.getTime() < readyAt.getTime()
    ? `Wait until ${readyAt.toISOString()}, one claim lease into the hold, so no dispatch is still running.`
    : null;
}

/**
 * Returns every live reminder delivery to the cron-only contract the code
 * before ADR 0267 relies on: pending, and due for publication at the job's own
 * next attempt time, with every job in a state that code can claim. Run only
 * when {@link reminderRollbackBlocker} allows, with
 * `REMINDER_DELIVERY_PUBLISH_AHEAD=off` set everywhere, before deploying code
 * that predates delayed wake-ups. That code publishes only pending rows that
 * are due, drops a pointer that arrives early, and never reclaims a `running`
 * job, so:
 *
 * - each delivery's revision is bumped, fencing out any publish still in
 *   flight so it cannot mark the reset row `published` again, and never
 *   reusing a key the provider may still be deduplicating on a roll-forward;
 * - a claim whose lease has expired becomes a retry due now.
 *
 * Pointers already in the queue then no-op while the cron publishes each job
 * when due.
 */
export async function resetReminderDeliveriesToCronOnly(
  now: Date = new Date(),
): Promise<{ reset: number; released: number }> {
  return withDatabaseTransaction(async () => {
    const released = await getDb()
      .update(reminderDeliveryJobs)
      .set({
        status: "failed",
        outcome: "transient_failure",
        nextAttemptAt: now,
        lastErrorCode: "claim_released_for_rollback",
        updatedAt: now,
      })
      .where(
        and(
          eq(reminderDeliveryJobs.status, "running"),
          lte(reminderDeliveryJobs.updatedAt, new Date(now.getTime() - REMINDER_DELIVERY_LEASE_MS)),
        ),
      )
      .returning({ id: reminderDeliveryJobs.id });
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
        revision: sql`${backgroundJobDeliveries.revision} + 1`,
        nextAttemptAt: sql`(select ${reminderDeliveryJobs.nextAttemptAt} from ${reminderDeliveryJobs} where ${reminderDeliveryJobs.id} = ${backgroundJobDeliveries.jobId})`,
        updatedAt: now,
      })
      .where(
        and(
          eq(backgroundJobDeliveries.jobKind, "reminder_push"),
          inArray(backgroundJobDeliveries.jobId, awaiting),
        ),
      )
      .returning({ id: backgroundJobDeliveries.id });
    return { reset: rows.length, released: released.length };
  });
}
