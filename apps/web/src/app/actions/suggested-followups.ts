"use server";

import {
  acceptCalendarSuggestedFollowup,
  dismissCalendarSuggestedFollowup,
} from "@tendnote/db/queries/calendar-followups";
import {
  acceptSuggestedFollowup,
  dismissSuggestedFollowup,
  editSuggestedFollowup,
  getSuggestedFollowupReview,
  restoreDismissedSuggestedFollowup,
} from "@tendnote/db/queries/followups";
import { affectedScopesForOwnerSurfaces } from "@tendnote/db/queries/general-actions";
import { affectedScopesForPerson } from "@tendnote/db/queries/people";
import { z } from "zod";
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
    body: async ({ ownerUserId, input: parsed }) => {
      const prior = await getSuggestedFollowupReview({
        actorUserId: ownerUserId,
        followupId: parsed.followupId,
      });
      if (!prior) throw new Error("Suggested follow-up not found.");
      const outcome = await dismissSuggestedFollowup({
        actorUserId: ownerUserId,
        followupId: parsed.followupId,
      });
      return { outcome, prior };
    },
    affectedScopes: ({ outcome }) => outcome.affectedScopes,
    result: ({ outcome, prior }) =>
      toSuggestedFollowupReviewView({ ...prior, followup: outcome.result }),
  });
}

export async function restoreDismissedSuggestedFollowupAction(input: { followupId: string }) {
  return runOwnerAction({
    schema: followupActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      restoreDismissedSuggestedFollowup({
        actorUserId: ownerUserId,
        followupId: parsed.followupId,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => toSuggestedFollowupReviewView(outcome.result),
  });
}

const calendarSuggestionActionSchema = z.object({ suggestionId: z.uuid() });

type CalendarSuggestedFollowupResolution = {
  suggestionId: string;
  status: string;
  acceptedFollowupId: string | null;
};

function calendarSuggestionScopes(suggestion: { personId: string | null }, ownerUserId: string) {
  return [
    ...affectedScopesForOwnerSurfaces(ownerUserId),
    ...(suggestion.personId
      ? affectedScopesForPerson({ ownerUserId, personId: suggestion.personId })
      : []),
  ];
}

export async function acceptCalendarSuggestedFollowupAction(input: { suggestionId: string }) {
  return runOwnerAction({
    schema: calendarSuggestionActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      acceptCalendarSuggestedFollowup({ ownerUserId, id: parsed.suggestionId }),
    affectedScopes: calendarSuggestionScopes,
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
    affectedScopes: (_suggestion, ownerUserId) => affectedScopesForOwnerSurfaces(ownerUserId),
    result: (suggestion): CalendarSuggestedFollowupResolution => ({
      suggestionId: suggestion.id,
      status: suggestion.status,
      acceptedFollowupId: suggestion.acceptedFollowupId,
    }),
  });
}
