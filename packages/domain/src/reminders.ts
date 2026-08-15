import { z } from "zod";
import { formatLocalDate, zonedWallTimeToUtc, zonedWallTimeToUtcStrict } from "./brief-schedules";

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
  if (record.kind === "general_action") {
    return record.recurrence === null && (record.status === "open" || record.status === "deferred");
  }
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

/**
 * Resolves one schedule choice using the same wall-time math at every save seam.
 *
 * Existing structured capture and editor callers keep the legacy normalization
 * default. Eve's explicit Action-plus-reminder preflight opts into strict mode
 * so issue #423 can clarify an impossible or ambiguous wall time before writing.
 */
export function resolveReminderIntendedAt(input: {
  occursAt: Date;
  timeSemantics: "date_only" | "instant";
  timeZone: string;
  choice: ReminderScheduleChoice;
  /** Eve's explicit create path rejects wall times that cannot be fulfilled. */
  wallTimeMode?: "legacy" | "strict";
}): Date {
  if (input.timeSemantics === "instant" && input.choice.kind === "relative") {
    return new Date(input.occursAt.getTime() - input.choice.leadMinutes * 60_000);
  }
  const occurrenceDate = input.occursAt.toISOString().slice(0, 10);
  const [year, month, day] = occurrenceDate.split("-").map(Number) as [number, number, number];
  const minute =
    input.choice.kind === "exact"
      ? Number(input.choice.localTime.slice(0, 2)) * 60 + Number(input.choice.localTime.slice(3))
      : 9 * 60;
  const resolveWallTime =
    input.wallTimeMode === "strict" ? zonedWallTimeToUtcStrict : zonedWallTimeToUtc;
  const base = resolveWallTime({
    timeZone: input.timeZone,
    year,
    month,
    day,
    minute,
  });
  return input.choice.kind === "relative"
    ? new Date(base.getTime() - input.choice.leadMinutes * 60_000)
    : base;
}

export function reminderScheduleChoiceFromStored(schedule: {
  kind: ReminderScheduleChoice["kind"];
  localTime: string | null;
  leadMinutes: number | null;
}): ReminderScheduleChoice {
  return schedule.kind === "exact"
    ? { kind: "exact", localTime: schedule.localTime ?? "09:00" }
    : { kind: "relative", leadMinutes: schedule.leadMinutes ?? 0 };
}

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

function formatLeadMinutes(leadMinutes: number) {
  const hours = Math.floor(leadMinutes / 60);
  const minutes = leadMinutes % 60;
  const parts = [
    hours > 0 ? `${hours} hour${hours === 1 ? "" : "s"}` : null,
    minutes > 0 ? `${minutes} minute${minutes === 1 ? "" : "s"}` : null,
  ].filter((part): part is string => part !== null);
  return parts.join(" ") || "0 minutes";
}

function formatLocalClockTime(timeZone: string, instant: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}

function relativeLabelForLead(leadMinutes: number, timeSemantics: "date_only" | "instant") {
  const duration = formatLeadMinutes(leadMinutes);
  return timeSemantics === "instant"
    ? `${duration} before the bring-back time`
    : `${duration} before at 9:00 AM`;
}

export function formatReminderChoiceLabel(
  choice: ReminderScheduleChoice,
  timeSemantics: "date_only" | "instant" = "date_only",
) {
  if (choice.kind === "exact") return `At ${choice.localTime}`;
  const label =
    (timeSemantics === "instant" ? INSTANT_RELATIVE_LABELS : DATE_ONLY_RELATIVE_LABELS)[
      choice.leadMinutes
    ] ?? relativeLabelForLead(choice.leadMinutes, timeSemantics);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatReminderScheduleLabel(
  schedule: {
    kind: ReminderScheduleChoice["kind"];
    localTime: string | null;
    leadMinutes: number | null;
    timeZone: string;
    intendedAt?: Date;
  },
  timeSemantics: "date_only" | "instant" = "date_only",
) {
  const leadMinutes = schedule.leadMinutes ?? 0;
  const knownRelativeLabel = (
    timeSemantics === "instant" ? INSTANT_RELATIVE_LABELS : DATE_ONLY_RELATIVE_LABELS
  )[leadMinutes];
  const hasConcreteIntendedAt =
    schedule.intendedAt instanceof Date && !Number.isNaN(schedule.intendedAt.getTime());
  const timing =
    schedule.kind === "exact"
      ? `at ${schedule.localTime ?? "09:00"}`
      : !knownRelativeLabel && hasConcreteIntendedAt
        ? `at ${formatLocalDate(schedule.timeZone, schedule.intendedAt as Date)} ${formatLocalClockTime(schedule.timeZone, schedule.intendedAt as Date)} (${formatLeadMinutes(leadMinutes)} before)`
        : formatReminderChoiceLabel({ kind: "relative", leadMinutes }, timeSemantics).toLowerCase();
  return `Reminder ${timing} · ${schedule.timeZone}`;
}
