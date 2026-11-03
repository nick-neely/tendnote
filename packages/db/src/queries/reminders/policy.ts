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

function claimLeaseExpired(job: Pick<ReminderDeliveryJob, "updatedAt">, now: Date): boolean {
  return job.updatedAt.getTime() <= now.getTime() - REMINDER_DELIVERY_LEASE_MS;
}

/** Pending or retrying work still owed a wake-up, due now or later. */
export function isReminderDeliveryJobAwaiting(
  job: Pick<ReminderDeliveryJob, "status" | "updatedAt">,
  now: Date,
): boolean {
  return (
    job.status === "pending" ||
    job.status === "failed" ||
    (job.status === "running" && claimLeaseExpired(job, now))
  );
}

/** Whether a delivery job may be claimed for dispatch at `now`. */
export function isReminderDeliveryJobClaimable(
  job: Pick<ReminderDeliveryJob, "status" | "nextAttemptAt" | "updatedAt">,
  now: Date,
): boolean {
  if (!isReminderDeliveryJobAwaiting(job, now)) return false;
  return job.status === "running" || job.nextAttemptAt.getTime() <= now.getTime();
}

/**
 * When a job should next be woken, or null when it is owed no wake-up: it is
 * finished, or a live claimant is dispatching it. An abandoned claim is due now.
 */
export function reminderDeliveryWakeupTime(
  job: Pick<ReminderDeliveryJob, "status" | "nextAttemptAt" | "updatedAt"> | null,
  now: Date,
): Date | null {
  if (!job || !isReminderDeliveryJobAwaiting(job, now)) return null;
  return job.status === "running" ? now : job.nextAttemptAt;
}

/**
 * Whether reminder wake-ups are published to the queue as soon as they are
 * scheduled, delayed to the alert time (ADR 0267). `off` is the rollback
 * switch: deliveries then wait for the recovery cron to publish them when due,
 * as before, while pointers already in flight still resolve safely.
 */
export function reminderDeliveryPublishesAhead(env: Record<string, string | undefined>): boolean {
  return env.REMINDER_DELIVERY_PUBLISH_AHEAD?.trim().toLowerCase() !== "off";
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
