"use server";

import {
  clearGeneralActionReminder,
  registerReminderInstallation,
  saveGeneralActionReminder,
  setReminderOptInDecision,
} from "@tendnote/db/queries/reminders";
import {
  reminderPushSubscriptionSchema,
  reminderScheduleChoiceSchema,
} from "@tendnote/domain/reminders";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";

const installationSchema = z.string().trim().min(12).max(200);

export async function clearGeneralActionReminderAction(input: { generalActionId: string }) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const parsed = z.object({ generalActionId: z.uuid() }).parse(input);
  await clearGeneralActionReminder({ ownerUserId, ...parsed, now: new Date() });
  return { ok: true as const };
}

export async function saveGeneralActionReminderAction(input: {
  generalActionId: string;
  clientInstallationId: string;
  timeZone: string;
  schedule: { kind: "exact"; localTime: string } | { kind: "relative"; leadMinutes: number };
}) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const parsed = z
    .object({
      generalActionId: z.uuid(),
      clientInstallationId: installationSchema,
      timeZone: z.string().trim().min(1).max(100),
      schedule: reminderScheduleChoiceSchema,
    })
    .parse(input);
  const result = await saveGeneralActionReminder({
    ownerUserId,
    ...parsed,
    now: new Date(),
  });
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
