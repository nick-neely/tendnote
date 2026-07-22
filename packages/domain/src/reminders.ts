import { z } from "zod";

export const reminderScheduleChoiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exact"), localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }),
  z.object({ kind: z.literal("relative"), leadMinutes: z.number().int().min(0).max(43_200) }),
]);
export type ReminderScheduleChoice = z.infer<typeof reminderScheduleChoiceSchema>;

export type ReminderSchedule = {
  id: string;
  ownerUserId: string;
  generalActionId: string;
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
  generalActionId: string;
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
  generalActionId: string;
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
