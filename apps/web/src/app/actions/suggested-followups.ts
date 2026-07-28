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
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { invalidatePersonMutation } from "@/lib/cache/people-mutation-scopes";
import { parseDateInputValue } from "@/lib/followup-view";
import { runOwnerAction } from "@/lib/owner-action";
import { toSuggestedFollowupReviewView } from "@/lib/suggested-followup-review-view";

const followupActionSchema = z.object({
  followupId: z.uuid(),
  edit: z
    .object({
      reason: z.string().trim().min(1).optional(),
      dueAt: z.string().transform(parseDateInputValue).optional(),
    })
    .optional(),
});

// One edit-validation path for both accept and edit: trims the reason and resolves
// a `YYYY-MM-DD` due date to local midnight. The shared review layer re-validates.
type SuggestedFollowupResolution = {
  followupId: string;
  status: string;
};

export async function acceptSuggestedFollowupAction(input: {
  followupId: string;
  edit?: { reason?: string; dueAt?: string };
}) {
  return runOwnerAction({
    schema: followupActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      acceptSuggestedFollowup({
        actorUserId: ownerUserId,
        followupId: parsed.followupId,
        edit: parsed.edit ?? {},
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => toSuggestedFollowupReviewView(outcome.result),
  });
}

export async function editSuggestedFollowupAction(input: {
  followupId: string;
  edit: { reason?: string; dueAt?: string };
}) {
  return runOwnerAction({
    schema: followupActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      editSuggestedFollowup({
        actorUserId: ownerUserId,
        followupId: parsed.followupId,
        edit: parsed.edit ?? {},
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => toSuggestedFollowupReviewView(outcome.result),
  });
}

export async function dismissSuggestedFollowupAction(input: { followupId: string }) {
  return runOwnerAction({
    schema: followupActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      dismissSuggestedFollowup({ actorUserId: ownerUserId, followupId: parsed.followupId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome): SuggestedFollowupResolution => ({
      followupId: outcome.result.id,
      status: outcome.result.status,
    }),
  });
}

const calendarSuggestionActionSchema = z.object({ suggestionId: z.uuid() });

type CalendarSuggestedFollowupResolution = {
  suggestionId: string;
  status: string;
  acceptedFollowupId: string | null;
};

export async function acceptCalendarSuggestedFollowupAction(input: { suggestionId: string }) {
  return runOwnerAction({
    schema: calendarSuggestionActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      acceptCalendarSuggestedFollowup({ ownerUserId, id: parsed.suggestionId }),
    reconcile: (suggestion, ownerUserId) => {
      if (suggestion.personId)
        invalidatePersonMutation({ ownerUserId, personId: suggestion.personId });
      revalidatePath("/");
    },
    result: (suggestion): CalendarSuggestedFollowupResolution => ({
      suggestionId: suggestion.id,
      status: suggestion.status,
      acceptedFollowupId: suggestion.acceptedFollowupId,
    }),
  });
}

export async function dismissCalendarSuggestedFollowupAction(input: { suggestionId: string }) {
  return runOwnerAction({
    schema: calendarSuggestionActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      dismissCalendarSuggestedFollowup({ ownerUserId, id: parsed.suggestionId }),
    reconcile: () => revalidatePath("/"),
    result: (suggestion): CalendarSuggestedFollowupResolution => ({
      suggestionId: suggestion.id,
      status: suggestion.status,
      acceptedFollowupId: suggestion.acceptedFollowupId,
    }),
  });
}
