"use server";

import {
  clearReminder,
  listReminderSchedulesForOwner,
  reconcileReminderRecord,
  registerReminderInstallation,
  saveReminder,
  setReminderOptInDecision,
} from "@tendnote/db/queries/reminders";
import {
  reminderPushSubscriptionSchema,
  reminderRecordKindSchema,
  reminderScheduleChoiceSchema,
} from "@tendnote/domain/reminders";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";

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
