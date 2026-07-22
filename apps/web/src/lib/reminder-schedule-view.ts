import {
  formatReminderScheduleLabel,
  type ReminderScheduleChoice,
} from "@tendnote/domain/reminders";

export type ReminderScheduleView = {
  kind: ReminderScheduleChoice["kind"];
  localTime: string | null;
  leadMinutes: number | null;
  timeZone: string;
  label: string;
};

export function toReminderScheduleView(
  schedule: {
    kind: ReminderScheduleChoice["kind"];
    localTime: string | null;
    leadMinutes: number | null;
    timeZone: string;
  },
  timeSemantics: "date_only" | "instant" = "date_only",
): ReminderScheduleView {
  return {
    ...schedule,
    label: formatReminderScheduleLabel(schedule, timeSemantics),
  };
}
