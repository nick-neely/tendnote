"use server";

import {
  archiveFollowup,
  completeFollowup,
  createBirthdayFollowupReminder,
  createFollowup,
  dismissFollowup,
  editFollowup,
  reopenFollowup,
  snoozeFollowup,
} from "@tendnote/db/queries/followups";
import { visibilityChoiceSchema } from "@tendnote/domain/privacy";
import { reminderScheduleChoiceSchema } from "@tendnote/domain/reminders";
import { z } from "zod";
import { parseDateInputValue, toFollowupView } from "@/lib/followup-view";
import { runOwnerAction } from "@/lib/owner-action";
import { toReminderScheduleView } from "@/lib/reminder-schedule-view";

const followupActionSchema = z.object({ followupId: z.uuid() });

// Due dates arrive from a date input as `YYYY-MM-DD`; resolve them to local
// midnight so the chosen day stays stable. The shared lifecycle then rejects
// anything that isn't a concrete date (PRD #42).
const dueDateInputSchema = z.string().transform(parseDateInputValue);

const createFollowupActionSchema = z.object({
  personId: z.uuid(),
  reason: z.string().trim().min(1, "Add a reason for this follow-up."),
  dueAt: dueDateInputSchema,
  visibilityChoice: visibilityChoiceSchema.default("only_me"),
  selectedUserIds: z.array(z.string().min(1)).optional(),
});

const editFollowupActionSchema = z.object({
  followupId: z.uuid(),
  edit: z.object({
    reason: z.string().trim().min(1).optional(),
    dueAt: dueDateInputSchema.optional(),
  }),
});

const snoozeFollowupActionSchema = z.object({
  followupId: z.uuid(),
  dueAt: dueDateInputSchema,
});

const birthdayFollowupSchema = z.object({
  personId: z.uuid(),
  clientInstallationId: z.string().trim().min(12).max(200),
  timeZone: z.string().trim().min(1).max(100),
  schedule: reminderScheduleChoiceSchema.refine((choice) => choice.kind === "relative", {
    message: "A Birthday Follow-Up schedule must be relative to the birthday.",
  }),
});

export async function createFollowupAction(input: {
  personId: string;
  reason: string;
  dueAt: string;
  visibilityChoice?: z.infer<typeof visibilityChoiceSchema>;
  selectedUserIds?: string[];
}) {
  return runOwnerAction({
    schema: createFollowupActionSchema,
    input,
    visibilityChoice: (parsed) => parsed.visibilityChoice,
    body: ({ ownerUserId, input: parsed, resolvedScope }) => {
      if (!resolvedScope) throw new Error("Owner action visibility scope was not resolved.");
      return createFollowup({
        ownerUserId,
        personId: parsed.personId,
        reason: parsed.reason,
        dueAt: parsed.dueAt,
        scope: resolvedScope.scope,
        householdId: resolvedScope.householdId,
        selectedUserIds: parsed.selectedUserIds,
      });
    },
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => toFollowupView(outcome.result),
  });
}

export async function createBirthdayFollowupAction(input: {
  personId: string;
  clientInstallationId: string;
  timeZone: string;
  schedule: { kind: "relative"; leadMinutes: number };
}) {
  return runOwnerAction({
    schema: birthdayFollowupSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      createBirthdayFollowupReminder({
        ownerUserId,
        personId: parsed.personId,
        clientInstallationId: parsed.clientInstallationId,
        timeZone: parsed.timeZone,
        schedule: parsed.schedule,
        now: new Date(),
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => ({
      view: toFollowupView(
        outcome.result.followup,
        new Date(),
        toReminderScheduleView(outcome.result.reminder.schedule),
      ),
      optIn: outcome.result.reminder.optIn,
    }),
  });
}

export async function editFollowupAction(input: {
  followupId: string;
  edit: { reason?: string; dueAt?: string };
}) {
  return runOwnerAction({
    schema: editFollowupActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      editFollowup({
        actorUserId: ownerUserId,
        followupId: parsed.followupId,
        edit: parsed.edit,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => toFollowupView(outcome.result),
  });
}

async function transitionAction(input: { followupId: string }, mutate: typeof completeFollowup) {
  return runOwnerAction({
    schema: followupActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      mutate({ actorUserId: ownerUserId, followupId: parsed.followupId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => toFollowupView(outcome.result),
  });
}

export async function completeFollowupAction(input: { followupId: string }) {
  return transitionAction(input, completeFollowup);
}

export async function dismissFollowupAction(input: { followupId: string }) {
  return transitionAction(input, dismissFollowup);
}

export async function reopenFollowupAction(input: { followupId: string }) {
  return transitionAction(input, reopenFollowup);
}

export async function archiveFollowupAction(input: { followupId: string }) {
  return transitionAction(input, archiveFollowup);
}

export async function snoozeFollowupAction(input: { followupId: string; dueAt: string }) {
  return runOwnerAction({
    schema: snoozeFollowupActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      snoozeFollowup({ actorUserId: ownerUserId, ...parsed }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => toFollowupView(outcome.result),
  });
}
