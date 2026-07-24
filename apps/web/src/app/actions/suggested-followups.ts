"use server";

import {
  acceptCalendarSuggestedFollowup,
  dismissCalendarSuggestedFollowup,
} from "@tendnote/db/queries/calendar-followups";
import {
  acceptSuggestedFollowup,
  dismissSuggestedFollowup,
  editSuggestedFollowup,
} from "@tendnote/db/queries/followups";
import type { FollowupEdit } from "@tendnote/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { invalidatePersonMutation } from "@/lib/cache/people-mutation-scopes";
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
function revalidatePerson(ownerUserId: string, personId: string) {
  invalidatePersonMutation({ ownerUserId, personId });
}

export async function acceptSuggestedFollowupAction(input: {
  followupId: string;
  edit?: { reason?: string; dueAt?: string };
}): Promise<SuggestedFollowupReviewView> {
  const { followupId } = followupActionSchema.parse({ followupId: input.followupId });
  const edit = parseFollowupEdit(input.edit);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const result = await acceptSuggestedFollowup({ actorUserId: ownerUserId, followupId, edit });

  revalidatePerson(ownerUserId, result.followup.personId);
  return toSuggestedFollowupReviewView(result);
}

export async function editSuggestedFollowupAction(input: {
  followupId: string;
  edit: { reason?: string; dueAt?: string };
}): Promise<SuggestedFollowupReviewView> {
  const { followupId } = followupActionSchema.parse({ followupId: input.followupId });
  const edit = parseFollowupEdit(input.edit);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const result = await editSuggestedFollowup({ actorUserId: ownerUserId, followupId, edit });

  revalidatePerson(ownerUserId, result.followup.personId);
  return toSuggestedFollowupReviewView(result);
}

export async function dismissSuggestedFollowupAction(input: {
  followupId: string;
}): Promise<SuggestedFollowupResolution> {
  const { followupId } = followupActionSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const followup = await dismissSuggestedFollowup({ actorUserId: ownerUserId, followupId });

  revalidatePerson(ownerUserId, followup.personId);
  return { followupId: followup.id, status: followup.status };
}

const calendarSuggestionActionSchema = z.object({ suggestionId: z.uuid() });

export type CalendarSuggestedFollowupResolution = {
  suggestionId: string;
  status: string;
  acceptedFollowupId: string | null;
};

export async function acceptCalendarSuggestedFollowupAction(input: {
  suggestionId: string;
}): Promise<CalendarSuggestedFollowupResolution> {
  const { suggestionId } = calendarSuggestionActionSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const suggestion = await acceptCalendarSuggestedFollowup({ ownerUserId, id: suggestionId });

  if (suggestion.personId) {
    revalidatePerson(ownerUserId, suggestion.personId);
  }
  revalidatePath("/");
  return {
    suggestionId: suggestion.id,
    status: suggestion.status,
    acceptedFollowupId: suggestion.acceptedFollowupId,
  };
}

export async function dismissCalendarSuggestedFollowupAction(input: {
  suggestionId: string;
}): Promise<CalendarSuggestedFollowupResolution> {
  const { suggestionId } = calendarSuggestionActionSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const suggestion = await dismissCalendarSuggestedFollowup({ ownerUserId, id: suggestionId });

  revalidatePath("/");
  return {
    suggestionId: suggestion.id,
    status: suggestion.status,
    acceptedFollowupId: suggestion.acceptedFollowupId,
  };
}
