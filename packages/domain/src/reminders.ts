import { z } from "zod";
import { formatLocalDate, zonedWallTimeToUtc } from "./brief-schedules";

export const reminderRecordKindSchema = z.enum([
  "general_action",
  "follow_up",
  "routine",
  "saved_item",
]);
export type ReminderRecordKind = z.infer<typeof reminderRecordKindSchema>;

export function nextBirthdayFollowupDueAt(input: {
  birthday: string;
  now: Date;
  timeZone: string;
}): Date {
  const match = input.birthday.match(/^(?:\d{4}-|--)(\d{2})-(\d{2})$/);
  if (!match?.[1] || !match[2]) throw new Error("A Birthday needs a valid month and day.");
  const month = Number(match[1]);
  const day = Number(match[2]);
  let year = Number(formatLocalDate(input.timeZone, input.now).slice(0, 4));
  for (let attempts = 0; attempts < 8; attempts += 1, year += 1) {
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    if (calendarDate.getUTCMonth() + 1 !== month || calendarDate.getUTCDate() !== day) continue;
    const candidate = zonedWallTimeToUtc({
      timeZone: input.timeZone,
      year,
      month,
      day,
      minute: 9 * 60,
    });
    if (candidate.getTime() > input.now.getTime()) return candidate;
  }
  throw new Error("Could not resolve the next Birthday occurrence.");
}

export const reminderScheduleChoiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exact"), localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }),
  z.object({ kind: z.literal("relative"), leadMinutes: z.number().int().min(0).max(43_200) }),
]);
export type ReminderScheduleChoice = z.infer<typeof reminderScheduleChoiceSchema>;

export type ReminderSchedule = {
  id: string;
  ownerUserId: string;
  recordKind: ReminderRecordKind;
  recordId: string;
  generalActionId: string | null;
  kind: ReminderScheduleChoice["kind"];
  localTime: string | null;
  leadMinutes: number | null;
  timeZone: string;
  occurrenceKey: string;
  intendedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type ReminderOccurrenceIntent = {
  id: string;
  ownerUserId: string;
  recordKind: ReminderRecordKind;
  recordId: string;
  generalActionId: string | null;
  scheduleId: string;
  occurrenceKey: string;
  intendedAt: Date;
  freshUntil: Date;
  status: "pending_installation" | "pending" | "superseded";
  createdAt: Date;
  updatedAt: Date;
};

export type ReminderOptInState = {
  ownerUserId: string;
  clientInstallationId: string;
  state: "offered" | "postponed" | "denied" | "registered";
  offeredAt: Date;
  inviteAfter: Date | null;
  updatedAt: Date;
};

export const reminderPushSubscriptionSchema = z.object({
  endpoint: z.url(),
  expirationTime: z.number().nullable(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
export type ReminderPushSubscription = z.infer<typeof reminderPushSubscriptionSchema>;

export type ReminderInstallation = {
  id: string;
  ownerUserId: string;
  clientInstallationId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: number | null;
  status: "enabled" | "disabled" | "revoked";
  previewMode: "generic" | "detailed";
  createdAt: Date;
  updatedAt: Date;
};

export type ReminderDeliveryJob = {
  id: string;
  ownerUserId: string;
  recordKind: ReminderRecordKind;
  recordId: string;
  generalActionId: string | null;
  scheduleId: string;
  occurrenceIntentId: string;
  installationId: string;
  occurrenceKey: string;
  intendedAt: Date;
  freshUntil: Date;
  status: "pending" | "running" | "completed" | "skipped" | "failed";
  outcome:
    | "accepted"
    | "transient_failure"
    | "terminal_endpoint"
    | "suppressed_stale"
    | "suppressed_revoked"
    | "suppressed_ineligible"
    | null;
  attempts: number;
  nextAttemptAt: Date;
  lastErrorCode: string | null;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const DATE_ONLY_RELATIVE_LABELS: Record<number, string> = {
  10080: "one week before at 9:00 AM",
  1440: "one day before at 9:00 AM",
  0: "at 9:00 AM on the due date",
};
const INSTANT_RELATIVE_LABELS: Record<number, string> = {
  10080: "one week before at the same time",
  1440: "one day before at the same time",
  60: "one hour before the bring-back time",
  0: "at the bring-back time",
};

export function formatReminderScheduleLabel(
  schedule: {
    kind: ReminderScheduleChoice["kind"];
    localTime: string | null;
    leadMinutes: number | null;
    timeZone: string;
  },
  timeSemantics: "date_only" | "instant" = "date_only",
) {
  const timing =
    schedule.kind === "exact"
      ? `at ${schedule.localTime ?? "09:00"}`
      : ((timeSemantics === "instant" ? INSTANT_RELATIVE_LABELS : DATE_ONLY_RELATIVE_LABELS)[
          schedule.leadMinutes ?? 0
        ] ?? "at the occurrence time");
  return `Reminder ${timing} · ${schedule.timeZone}`;
}
