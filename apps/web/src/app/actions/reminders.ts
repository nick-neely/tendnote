"use server";

import {
  beginReminderInstallationOptIn,
  claimReminderStandaloneContinuation,
  clearReminder,
  disableCurrentReminderInstallation,
  disableReminderInstallation,
  getReminderInstallationState,
  listReminderSchedulesForOwner,
  markReminderStandaloneContinuation,
  reconcileReminderRecord,
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
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { invalidateActionMutation } from "@/lib/cache/action-mutation-scopes";

const installationSchema = z.string().trim().min(12).max(200);
const recordReferenceSchema = z.object({
  recordKind: reminderRecordKindSchema,
  recordId: z.uuid(),
});

export async function clearReminderAction(input: {
  recordKind: z.infer<typeof reminderRecordKindSchema>;
  recordId: string;
}) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const parsed = recordReferenceSchema.parse(input);
  await clearReminder({ ownerUserId, ...parsed, now: new Date() });
  if (parsed.recordKind === "general_action" || parsed.recordKind === "routine") {
    invalidateActionMutation({ ownerUserId, actionId: parsed.recordId });
  }
  return { ok: true as const };
}

export async function saveReminderAction(input: {
  recordKind: z.infer<typeof reminderRecordKindSchema>;
  recordId: string;
  clientInstallationId: string;
  timeZone: string;
  schedule: { kind: "exact"; localTime: string } | { kind: "relative"; leadMinutes: number };
}) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const parsed = recordReferenceSchema
    .extend({
      clientInstallationId: installationSchema,
      timeZone: z.string().trim().min(1).max(100),
      schedule: reminderScheduleChoiceSchema,
    })
    .parse(input);
  const result = await saveReminder({ ownerUserId, ...parsed, now: new Date() });
  if (parsed.recordKind === "general_action" || parsed.recordKind === "routine") {
    invalidateActionMutation({ ownerUserId, actionId: parsed.recordId });
  }
  return reminderScheduleResult(result);
}

export async function reconcileReminderTimeZoneAction(input: { timeZone: string }) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const { timeZone } = z.object({ timeZone: z.string().trim().min(1).max(100) }).parse(input);
  const schedules = await listReminderSchedulesForOwner({ ownerUserId });
  await Promise.all(
    schedules.map((schedule) =>
      reconcileReminderRecord({
        ownerUserId,
        recordKind: schedule.recordKind,
        recordId: schedule.recordId,
        timeZone,
        now: new Date(),
      }),
    ),
  );
  return { reconciled: schedules.length };
}

function reminderScheduleResult(result: Awaited<ReturnType<typeof saveReminder>>) {
  return {
    optIn: result.optIn,
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
  const ownerUserId = await requireAdmittedOwnerForAction();
  const parsed = z
    .object({
      clientInstallationId: installationSchema,
      label: z.string().trim().min(1).max(80).optional(),
      subscription: reminderPushSubscriptionSchema,
    })
    .parse(input);
  const result = await registerReminderInstallation({ ownerUserId, ...parsed, now: new Date() });
  return { enabled: result.installation.status === "enabled" };
}

export async function setReminderOptInDecisionAction(input: {
  clientInstallationId: string;
  decision: "postponed" | "denied";
}) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const parsed = z
    .object({ clientInstallationId: installationSchema, decision: z.enum(["postponed", "denied"]) })
    .parse(input);
  await setReminderOptInDecision({ ownerUserId, ...parsed, now: new Date() });
  return { ok: true as const };
}

export async function getReminderInstallationStateAction(input: { clientInstallationId: string }) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const parsed = z.object({ clientInstallationId: installationSchema }).parse(input);
  return getReminderInstallationState({ ownerUserId, ...parsed });
}

export async function beginReminderInstallationOptInAction(input: {
  clientInstallationId: string;
}) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const parsed = z.object({ clientInstallationId: installationSchema }).parse(input);
  await beginReminderInstallationOptIn({ ownerUserId, ...parsed, now: new Date() });
  return { ok: true as const };
}

export async function markReminderStandaloneContinuationAction(input: {
  clientInstallationId: string;
}) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const parsed = z.object({ clientInstallationId: installationSchema }).parse(input);
  await markReminderStandaloneContinuation({ ownerUserId, ...parsed, now: new Date() });
  return { ok: true as const };
}

export async function claimReminderStandaloneContinuationAction(input: {
  clientInstallationId: string;
}) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const parsed = z.object({ clientInstallationId: installationSchema }).parse(input);
  const claimed = await claimReminderStandaloneContinuation({
    ownerUserId,
    ...parsed,
    now: new Date(),
  });
  return { claimed: claimed !== null };
}

export async function setReminderInstallationPreviewModeAction(input: {
  clientInstallationId: string;
  previewMode: "generic" | "detailed";
}) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const parsed = z
    .object({
      clientInstallationId: installationSchema,
      previewMode: z.enum(["generic", "detailed"]),
    })
    .parse(input);
  const installation = await setReminderInstallationPreviewMode({
    ownerUserId,
    ...parsed,
    now: new Date(),
  });
  return { previewMode: installation.previewMode };
}

export async function disableCurrentReminderInstallationAction(input: {
  clientInstallationId: string;
  reason: "current_installation" | "sign_out";
}) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const parsed = z
    .object({
      clientInstallationId: installationSchema,
      reason: z.enum(["current_installation", "sign_out"]),
    })
    .parse(input);
  await disableCurrentReminderInstallation({ ownerUserId, ...parsed, now: new Date() });
  return { ok: true as const };
}

export async function revokeReminderInstallationAction(input: { installationId: string }) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const { installationId } = z.object({ installationId: z.uuid() }).parse(input);
  await disableReminderInstallation({
    ownerUserId,
    installationId,
    reason: "remote_revocation",
    now: new Date(),
  });
  return { ok: true as const };
}
