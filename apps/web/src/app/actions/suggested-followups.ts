"use server";

import {
  acceptSuggestedFollowup,
  dismissSuggestedFollowup,
  editSuggestedFollowup,
} from "@tendnote/db/queries/followups";
import type { FollowupEdit } from "@tendnote/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { parseDateInputValue } from "@/lib/followup-view";
import {
  type SuggestedFollowupReviewView,
  toSuggestedFollowupReviewView,
} from "@/lib/suggested-followup-review-view";

const followupActionSchema = z.object({ followupId: z.uuid() });

// One edit-validation path for both accept and edit: trims the reason and resolves
// a `YYYY-MM-DD` due date to local midnight. The shared review layer re-validates.
const followupEditInputSchema = z.object({
  reason: z.string().trim().min(1).optional(),
  dueAt: z.string().transform(parseDateInputValue).optional(),
});

function parseFollowupEdit(edit: { reason?: string; dueAt?: string } = {}): FollowupEdit {
  const parsed = followupEditInputSchema.parse(edit);

  return {
    ...(parsed.reason !== undefined ? { reason: parsed.reason } : {}),
    ...(parsed.dueAt !== undefined ? { dueAt: parsed.dueAt } : {}),
  };
}

export type SuggestedFollowupResolution = {
  followupId: string;
  status: string;
};

/** Re-render the person's profile after a review action so the surfaces agree. */
function revalidatePerson(personId: string) {
  revalidatePath(`/people/${personId}`);
}

export async function acceptSuggestedFollowupAction(input: {
  followupId: string;
  edit?: { reason?: string; dueAt?: string };
}): Promise<SuggestedFollowupReviewView> {
  const { followupId } = followupActionSchema.parse({ followupId: input.followupId });
  const edit = parseFollowupEdit(input.edit);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const result = await acceptSuggestedFollowup({ ownerUserId, followupId, edit });

  revalidatePerson(result.followup.personId);
  return toSuggestedFollowupReviewView(result);
}

export async function editSuggestedFollowupAction(input: {
  followupId: string;
  edit: { reason?: string; dueAt?: string };
}): Promise<SuggestedFollowupReviewView> {
  const { followupId } = followupActionSchema.parse({ followupId: input.followupId });
  const edit = parseFollowupEdit(input.edit);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const result = await editSuggestedFollowup({ ownerUserId, followupId, edit });

  revalidatePerson(result.followup.personId);
  return toSuggestedFollowupReviewView(result);
}

export async function dismissSuggestedFollowupAction(input: {
  followupId: string;
}): Promise<SuggestedFollowupResolution> {
  const { followupId } = followupActionSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const followup = await dismissSuggestedFollowup({ ownerUserId, followupId });

  revalidatePerson(followup.personId);
  return { followupId: followup.id, status: followup.status };
}
