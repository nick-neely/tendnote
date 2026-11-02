import { isReminderRecordEligible, type ReminderDeliveryJob } from "@tendnote/domain/reminders";
import type { ReminderRecord } from "./types";

/**
 * How long a claimed (`running`) delivery job is left to its claimant before
 * another may take it over. A dispatch makes one push request with a ten
 * second socket timeout inside a sixty second queue visibility window, so a
 * claim still running after five minutes belongs to a process that died. The
 * takeover may repeat a push the dead process had already handed over; the
 * notification's per-job tag makes the device show it once.
 */
export const REMINDER_DELIVERY_LEASE_MS = 5 * 60_000;

/** Whether a delivery job may be claimed for dispatch at `now`. */
export function isReminderDeliveryJobClaimable(
  job: Pick<ReminderDeliveryJob, "status" | "nextAttemptAt" | "updatedAt">,
  now: Date,
): boolean {
  if (job.status === "running") {
    return job.updatedAt.getTime() <= now.getTime() - REMINDER_DELIVERY_LEASE_MS;
  }
  return (
    (job.status === "pending" || job.status === "failed") &&
    job.nextAttemptAt.getTime() <= now.getTime()
  );
}

/** Pending or retrying work still owed a wake-up, due now or later. */
export function isReminderDeliveryJobAwaiting(
  job: Pick<ReminderDeliveryJob, "status" | "updatedAt">,
  now: Date,
): boolean {
  return (
    job.status === "pending" ||
    job.status === "failed" ||
    (job.status === "running" &&
      job.updatedAt.getTime() <= now.getTime() - REMINDER_DELIVERY_LEASE_MS)
  );
}

export function isEligibleReminderRecord(
  record: ReminderRecord | null,
): record is ReminderRecord & { occursAt: Date } {
  return Boolean(record && isReminderRecordEligible(record));
}

export function reminderOccurrenceKey(record: ReminderRecord & { occursAt: Date }): string {
  const occurrence =
    record.timeSemantics === "instant"
      ? record.occursAt.toISOString()
      : record.occursAt.toISOString().slice(0, 10);
  return `${record.kind}:${record.id}:${occurrence}`;
}

/**
 * Who a loaded record's schedule may belong to.
 *
 * The record's owner unless its loader named someone else, which only a
 * visibility-keyed loader does. Reading it through one function keeps the
 * fallback in a single place: a workspace-owned record has a null owner, so
 * every comparison against a real user id fails and nobody is authorized by
 * default (ADR 0214).
 */
export function reminderSubscriber(record: ReminderRecord | null): string | null {
  return record ? (record.subscriberUserId ?? record.ownerUserId) : null;
}
