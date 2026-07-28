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
