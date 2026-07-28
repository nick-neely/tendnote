import { z } from "zod";
import { formatLocalDate, zonedWallTimeToUtc } from "./brief-schedules";

export const reminderRecordKindSchema = z.enum([
  "general_action",
  "follow_up",
  "routine",
  "saved_item",
]);
export type ReminderRecordKind = z.infer<typeof reminderRecordKindSchema>;

const REMINDER_RECORD_POLICY = {
  general_action: { timeSemantics: "date_only" },
  follow_up: { timeSemantics: "date_only" },
  routine: { timeSemantics: "date_only" },
  saved_item: { timeSemantics: "instant" },
} as const satisfies Record<ReminderRecordKind, { timeSemantics: "date_only" | "instant" }>;

export function reminderTimeSemanticsForRecordKind(recordKind: ReminderRecordKind) {
  return REMINDER_RECORD_POLICY[recordKind].timeSemantics;
}

export function isReminderRecordEligible(record: {
  kind: ReminderRecordKind;
  status: string;
  occursAt: Date | null;
  recurrence: unknown | null;
  sensitivity: "normal" | "sensitive" | "restricted";
}) {
  if (!record.occursAt || record.sensitivity === "restricted") return false;
  if (record.kind === "saved_item") return record.status === "active";
  if (record.status !== "open") return false;
  return record.kind === "routine" ? record.recurrence !== null : record.recurrence === null;
}

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
  state: "offered" | "postponed" | "denied" | "registered" | "disabled";
  offeredAt: Date;
  inviteAfter: Date | null;
  standaloneContinuationExpiresAt: Date | null;
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
  label: string;
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
  expirationTime: number | null;
  status: "enabled" | "disabled" | "revoked";
  previewMode: "generic" | "detailed";
  createdAt: Date;
  updatedAt: Date;
};

export type ReminderInstallationSummary = Pick<
  ReminderInstallation,
  "id" | "clientInstallationId" | "label" | "status" | "previewMode" | "updatedAt"
>;

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

export function formatReminderChoiceLabel(
  choice: ReminderScheduleChoice,
  timeSemantics: "date_only" | "instant" = "date_only",
) {
  if (choice.kind === "exact") return `At ${choice.localTime}`;
  const label =
    (timeSemantics === "instant" ? INSTANT_RELATIVE_LABELS : DATE_ONLY_RELATIVE_LABELS)[
      choice.leadMinutes
    ] ?? "at the occurrence time";
  return label.charAt(0).toUpperCase() + label.slice(1);
}

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
      : formatReminderChoiceLabel(
          { kind: "relative", leadMinutes: schedule.leadMinutes ?? 0 },
          timeSemantics,
        ).toLowerCase();
  return `Reminder ${timing} · ${schedule.timeZone}`;
}
