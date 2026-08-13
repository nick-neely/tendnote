"use server";

import {
  beginReminderInstallationOptIn,
  claimReminderStandaloneContinuation,
  clearReminder,
  disableCurrentReminderInstallation,
  disableReminderInstallation,
  getReminderInstallationState,
  markReminderStandaloneContinuation,
  reconcileReminderTimeZone,
  registerReminderInstallation,
  saveReminder,
  setReminderInstallationPreviewMode,
  setReminderOptInDecision,
} from "@tendnote/db/queries/reminders";
import {
  reminderPushSubscriptionSchema,
  reminderRecordKindSchema,
  reminderScheduleChoiceSchema,
} from "@tendnote/domain/reminders";
import { z } from "zod";
import { runOwnerAction } from "@/lib/owner-action";

const installationSchema = z.string().trim().min(12).max(200);
const recordReferenceSchema = z.object({
  recordKind: reminderRecordKindSchema,
  recordId: z.uuid(),
});

export async function clearReminderAction(input: {
  recordKind: z.infer<typeof reminderRecordKindSchema>;
  recordId: string;
}) {
  return runOwnerAction({
    schema: recordReferenceSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      clearReminder({ ownerUserId, ...parsed, now: new Date() }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: () => ({ ok: true as const }),
  });
}

export async function saveReminderAction(input: {
  recordKind: z.infer<typeof reminderRecordKindSchema>;
  recordId: string;
  clientInstallationId: string;
  timeZone: string;
  schedule: { kind: "exact"; localTime: string } | { kind: "relative"; leadMinutes: number };
}) {
  return runOwnerAction({
    schema: recordReferenceSchema.extend({
      clientInstallationId: installationSchema,
      timeZone: z.string().trim().min(1).max(100),
      schedule: reminderScheduleChoiceSchema,
    }),
    input,
    body: ({ ownerUserId, input: parsed }) =>
      saveReminder({ ownerUserId, ...parsed, now: new Date() }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => reminderScheduleResult(outcome.result),
  });
}

export async function reconcileReminderTimeZoneAction(input: {
  timeZone: string;
  offset?: number;
}) {
  return runOwnerAction({
    schema: z.object({
      timeZone: z.string().trim().min(1).max(100),
      offset: z.number().int().min(0).optional(),
    }),
    input,
    body: ({ ownerUserId, input: parsed }) =>
      reconcileReminderTimeZone({ ownerUserId, ...parsed, now: new Date() }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => ({
      reconciled: outcome.result.reconciled,
      remaining: outcome.result.remaining,
      nextOffset: outcome.result.nextOffset,
    }),
  });
}

function reminderScheduleResult(result: Awaited<ReturnType<typeof saveReminder>>["result"]) {
  return {
    optIn: result.optIn,
    occurrenceIntentCreated: result.occurrenceIntent !== null,
    nextValidChoice: result.nextValidChoice,
    schedule: {
      kind: result.schedule.kind,
      localTime: result.schedule.localTime,
      leadMinutes: result.schedule.leadMinutes,
      timeZone: result.schedule.timeZone,
      intendedAtISO: result.schedule.intendedAt.toISOString(),
    },
  };
}

export async function registerReminderInstallationAction(input: {
  clientInstallationId: string;
  label?: string;
  subscription: {
    endpoint: string;
    expirationTime: number | null;
    keys: { p256dh: string; auth: string };
  };
}) {
  return runOwnerAction({
    schema: z.object({
      clientInstallationId: installationSchema,
      label: z.string().trim().min(1).max(80).optional(),
      subscription: reminderPushSubscriptionSchema,
    }),
    input,
    body: ({ ownerUserId, input: parsed }) =>
      registerReminderInstallation({ ownerUserId, ...parsed, now: new Date() }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => ({ enabled: outcome.result.installation.status === "enabled" }),
  });
}

export async function setReminderOptInDecisionAction(input: {
  clientInstallationId: string;
  decision: "postponed" | "denied";
}) {
  return runOwnerAction({
    schema: z.object({
      clientInstallationId: installationSchema,
      decision: z.enum(["postponed", "denied"]),
    }),
    input,
    body: ({ ownerUserId, input: parsed }) =>
      setReminderOptInDecision({ ownerUserId, ...parsed, now: new Date() }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: () => ({ ok: true as const }),
  });
}

export async function getReminderInstallationStateAction(input: { clientInstallationId: string }) {
  return runOwnerAction({
    schema: z.object({ clientInstallationId: installationSchema }),
    input,
    body: ({ ownerUserId, input: parsed }) =>
      getReminderInstallationState({ ownerUserId, ...parsed }),
    result: (state) => state,
  });
}

export async function beginReminderInstallationOptInAction(input: {
  clientInstallationId: string;
}) {
  return runOwnerAction({
    schema: z.object({ clientInstallationId: installationSchema }),
    input,
    body: ({ ownerUserId, input: parsed }) =>
      beginReminderInstallationOptIn({ ownerUserId, ...parsed, now: new Date() }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: () => ({ ok: true as const }),
  });
}

export async function markReminderStandaloneContinuationAction(input: {
  clientInstallationId: string;
}) {
  return runOwnerAction({
    schema: z.object({ clientInstallationId: installationSchema }),
    input,
    body: ({ ownerUserId, input: parsed }) =>
      markReminderStandaloneContinuation({ ownerUserId, ...parsed, now: new Date() }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: () => ({ ok: true as const }),
  });
}

export async function claimReminderStandaloneContinuationAction(input: {
  clientInstallationId: string;
}) {
  return runOwnerAction({
    schema: z.object({ clientInstallationId: installationSchema }),
    input,
    body: ({ ownerUserId, input: parsed }) =>
      claimReminderStandaloneContinuation({
        ownerUserId,
        ...parsed,
        now: new Date(),
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => ({ claimed: outcome.result !== null }),
  });
}

export async function setReminderInstallationPreviewModeAction(input: {
  clientInstallationId: string;
  previewMode: "generic" | "detailed";
}) {
  return runOwnerAction({
    schema: z.object({
      clientInstallationId: installationSchema,
      previewMode: z.enum(["generic", "detailed"]),
    }),
    input,
    body: ({ ownerUserId, input: parsed }) =>
      setReminderInstallationPreviewMode({
        ownerUserId,
        ...parsed,
        now: new Date(),
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => ({ previewMode: outcome.result.previewMode }),
  });
}

export async function disableCurrentReminderInstallationAction(input: {
  clientInstallationId: string;
  reason: "current_installation" | "sign_out";
}) {
  return runOwnerAction({
    schema: z.object({
      clientInstallationId: installationSchema,
      reason: z.enum(["current_installation", "sign_out"]),
    }),
    input,
    body: ({ ownerUserId, input: parsed }) =>
      disableCurrentReminderInstallation({ ownerUserId, ...parsed, now: new Date() }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: () => ({ ok: true as const }),
  });
}

export async function revokeReminderInstallationAction(input: { installationId: string }) {
  return runOwnerAction({
    schema: z.object({ installationId: z.uuid() }),
    input,
    body: ({ ownerUserId, input: { installationId } }) =>
      disableReminderInstallation({
        ownerUserId,
        installationId,
        reason: "remote_revocation",
        now: new Date(),
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: () => ({ ok: true as const }),
  });
}
