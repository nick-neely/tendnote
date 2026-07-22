import type { ReminderScheduleChoice } from "@tendnote/domain/reminders";

export type ReminderScheduleView = {
  kind: ReminderScheduleChoice["kind"];
  localTime: string | null;
  leadMinutes: number | null;
  timeZone: string;
  label: string;
};

export function toReminderScheduleView(schedule: {
  kind: ReminderScheduleChoice["kind"];
  localTime: string | null;
  leadMinutes: number | null;
  timeZone: string;
}): ReminderScheduleView {
  const timing =
    schedule.kind === "exact"
      ? `at ${schedule.localTime ?? "09:00"}`
      : schedule.leadMinutes === 10_080
        ? "one week before at 9:00 AM"
        : schedule.leadMinutes === 1_440
          ? "one day before at 9:00 AM"
          : "at 9:00 AM on the due date";
  return {
    ...schedule,
    label: `Reminder ${timing} · ${schedule.timeZone}`,
  };
}
