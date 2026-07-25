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
import { listActiveHouseholdMembershipsForUser } from "@tendnote/db/queries/households";
import type { Followup } from "@tendnote/domain";
import { scopeForVisibilityChoice, visibilityChoiceSchema } from "@tendnote/domain/privacy";
import { reminderScheduleChoiceSchema } from "@tendnote/domain/reminders";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import {
  peopleMutationScopes,
  updatePeopleMutationScopes,
} from "@/lib/cache/people-mutation-scopes";
import { type FollowupView, parseDateInputValue, toFollowupView } from "@/lib/followup-view";
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
  reason: z.string().trim().min(1).optional(),
  dueAt: dueDateInputSchema.optional(),
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

export type FollowupMutationResult = FollowupView & {
  affectedScopes: ReturnType<typeof peopleMutationScopes.forPerson>;
  revision: string;
};

/**
 * Re-render the person's profile after a lifecycle change so the snapshot card and
 * any server-rendered context reflect it. The interactive list manages its own
 * optimistic state, so this is scoped to the one affected page rather than purging
 * the whole app cache (mirrors the calm, narrow revalidation the siblings favor).
 */
function revalidatePerson(ownerUserId: string, personId: string) {
  const affectedScopes = peopleMutationScopes.forPerson({ ownerUserId, personId });
  updatePeopleMutationScopes(affectedScopes);
  return affectedScopes;
}

function authoritativeFollowupResult(
  _actorUserId: string,
  followup: Followup,
): FollowupMutationResult {
  return {
    ...toFollowupView(followup),
    // A household viewer may act on a shared follow-up. Its owner-scoped
    // projection belongs to the persisted record owner, while the shared
    // entity scope also expires every viewer's detail projection.
    affectedScopes: revalidatePerson(followup.ownerUserId, followup.personId),
    revision: followup.updatedAt.toISOString(),
  };
}

export async function createFollowupAction(input: {
  personId: string;
  reason: string;
  dueAt: string;
  visibilityChoice?: z.infer<typeof visibilityChoiceSchema>;
  selectedUserIds?: string[];
}): Promise<FollowupMutationResult> {
  const parsed = createFollowupActionSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const scope = scopeForVisibilityChoice(parsed.visibilityChoice);
  const memberships =
    scope === "private" ? [] : await listActiveHouseholdMembershipsForUser({ userId: ownerUserId });
  const householdId = scope === "private" ? null : (memberships[0]?.householdId ?? null);
  const followup = await createFollowup({
    ownerUserId,
    personId: parsed.personId,
    reason: parsed.reason,
    dueAt: parsed.dueAt,
    scope,
    householdId,
    selectedUserIds: parsed.selectedUserIds,
  });

  return authoritativeFollowupResult(ownerUserId, followup);
}

export async function createBirthdayFollowupAction(input: {
  personId: string;
  clientInstallationId: string;
  timeZone: string;
  schedule: { kind: "relative"; leadMinutes: number };
}): Promise<{
  view: FollowupMutationResult;
  optIn: { state: "offer" | "none"; clientInstallationId: string };
}> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const parsed = birthdayFollowupSchema.parse(input);
  const { followup, reminder } = await createBirthdayFollowupReminder({
    ownerUserId,
    personId: parsed.personId,
    clientInstallationId: parsed.clientInstallationId,
    timeZone: parsed.timeZone,
    schedule: parsed.schedule,
    now: new Date(),
  });
  const affectedScopes = revalidatePerson(followup.ownerUserId, followup.personId);
  return {
    view: {
      ...toFollowupView(followup, new Date(), toReminderScheduleView(reminder.schedule)),
      affectedScopes,
      revision: followup.updatedAt.toISOString(),
    },
    optIn: reminder.optIn,
  };
}

export async function editFollowupAction(input: {
  followupId: string;
  edit: { reason?: string; dueAt?: string };
}): Promise<FollowupMutationResult> {
  const parsed = editFollowupActionSchema.parse({
    followupId: input.followupId,
    ...input.edit,
  });
  const ownerUserId = await requireAdmittedOwnerForAction();
  const followup = await editFollowup({
    actorUserId: ownerUserId,
    followupId: parsed.followupId,
    edit: {
      ...(parsed.reason !== undefined ? { reason: parsed.reason } : {}),
      ...(parsed.dueAt !== undefined ? { dueAt: parsed.dueAt } : {}),
    },
  });

  return authoritativeFollowupResult(ownerUserId, followup);
}

async function transitionAction(
  followupId: string,
  run: (input: { actorUserId: string; followupId: string }) => Promise<Followup>,
): Promise<FollowupMutationResult> {
  const parsed = followupActionSchema.parse({ followupId });
  const ownerUserId = await requireAdmittedOwnerForAction();
  const followup = await run({ actorUserId: ownerUserId, followupId: parsed.followupId });

  return authoritativeFollowupResult(ownerUserId, followup);
}

export async function completeFollowupAction(input: {
  followupId: string;
}): Promise<FollowupMutationResult> {
  return transitionAction(input.followupId, completeFollowup);
}

export async function dismissFollowupAction(input: {
  followupId: string;
}): Promise<FollowupMutationResult> {
  return transitionAction(input.followupId, dismissFollowup);
}

export async function reopenFollowupAction(input: {
  followupId: string;
}): Promise<FollowupMutationResult> {
  return transitionAction(input.followupId, reopenFollowup);
}

export async function archiveFollowupAction(input: {
  followupId: string;
}): Promise<FollowupMutationResult> {
  return transitionAction(input.followupId, archiveFollowup);
}

export async function snoozeFollowupAction(input: {
  followupId: string;
  dueAt: string;
}): Promise<FollowupMutationResult> {
  const parsed = snoozeFollowupActionSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const followup = await snoozeFollowup({ actorUserId: ownerUserId, ...parsed });

  return authoritativeFollowupResult(ownerUserId, followup);
}
