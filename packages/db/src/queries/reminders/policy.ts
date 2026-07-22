import type { ReminderRecord } from "./types";

export function isEligibleReminderRecord(
  record: ReminderRecord | null,
): record is ReminderRecord & { occursAt: Date } {
  if (!record?.occursAt || record.sensitivity === "restricted") return false;
  if (record.kind === "saved_item") return record.status === "active";
  if (record.status !== "open") return false;
  return record.kind === "routine" ? record.recurrence !== null : record.recurrence === null;
}

export function reminderOccurrenceKey(record: ReminderRecord & { occursAt: Date }): string {
  const occurrence =
    record.timeSemantics === "instant"
      ? record.occursAt.toISOString()
      : record.occursAt.toISOString().slice(0, 10);
  return `${record.kind}:${record.id}:${occurrence}`;
}
