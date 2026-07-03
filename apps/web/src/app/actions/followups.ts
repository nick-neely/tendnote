"use server";

import {
  archiveFollowup,
  completeFollowup,
  createFollowup,
  dismissFollowup,
  editFollowup,
  reopenFollowup,
  snoozeFollowup,
} from "@tendnote/db/queries/followups";
import { listActiveHouseholdMembershipsForUser } from "@tendnote/db/queries/households";
import type { Followup } from "@tendnote/domain";
import { scopeForVisibilityChoice, visibilityChoiceSchema } from "@tendnote/domain/privacy";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { type FollowupView, parseDateInputValue, toFollowupView } from "@/lib/followup-view";

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

/**
 * Re-render the person's profile after a lifecycle change so the snapshot card and
 * any server-rendered context reflect it. The interactive list manages its own
 * optimistic state, so this is scoped to the one affected page rather than purging
 * the whole app cache (mirrors the calm, narrow revalidation the siblings favor).
 */
function revalidatePerson(personId: string) {
  revalidatePath(`/people/${personId}`);
}

export async function createFollowupAction(input: {
  personId: string;
  reason: string;
  dueAt: string;
  visibilityChoice?: z.infer<typeof visibilityChoiceSchema>;
  selectedUserIds?: string[];
}): Promise<FollowupView> {
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

  revalidatePerson(followup.personId);
  return toFollowupView(followup);
}

export async function editFollowupAction(input: {
  followupId: string;
  edit: { reason?: string; dueAt?: string };
}): Promise<FollowupView> {
  const parsed = editFollowupActionSchema.parse({
    followupId: input.followupId,
    ...input.edit,
  });
  const ownerUserId = await requireAdmittedOwnerForAction();
  const followup = await editFollowup({
    ownerUserId,
    followupId: parsed.followupId,
    edit: {
      ...(parsed.reason !== undefined ? { reason: parsed.reason } : {}),
      ...(parsed.dueAt !== undefined ? { dueAt: parsed.dueAt } : {}),
    },
  });

  revalidatePerson(followup.personId);
  return toFollowupView(followup);
}

async function transitionAction(
  followupId: string,
  run: (input: { ownerUserId: string; followupId: string }) => Promise<Followup>,
): Promise<FollowupView> {
  const parsed = followupActionSchema.parse({ followupId });
  const ownerUserId = await requireAdmittedOwnerForAction();
  const followup = await run({ ownerUserId, followupId: parsed.followupId });

  revalidatePerson(followup.personId);
  return toFollowupView(followup);
}

export async function completeFollowupAction(input: { followupId: string }): Promise<FollowupView> {
  return transitionAction(input.followupId, completeFollowup);
}

export async function dismissFollowupAction(input: { followupId: string }): Promise<FollowupView> {
  return transitionAction(input.followupId, dismissFollowup);
}

export async function reopenFollowupAction(input: { followupId: string }): Promise<FollowupView> {
  return transitionAction(input.followupId, reopenFollowup);
}

export async function archiveFollowupAction(input: { followupId: string }): Promise<FollowupView> {
  return transitionAction(input.followupId, archiveFollowup);
}

export async function snoozeFollowupAction(input: {
  followupId: string;
  dueAt: string;
}): Promise<FollowupView> {
  const parsed = snoozeFollowupActionSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const followup = await snoozeFollowup({ ownerUserId, ...parsed });

  revalidatePerson(followup.personId);
  return toFollowupView(followup);
}
