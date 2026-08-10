import { isReminderRecordEligible } from "@tendnote/domain/reminders";
import type { ReminderRecord } from "./types";

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
