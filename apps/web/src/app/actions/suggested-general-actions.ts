"use server";

import { listGeneralActionAreas } from "@tendnote/db/queries/general-action-areas";
import {
  acceptSuggestedGeneralAction,
  dismissSuggestedGeneralAction,
  editSuggestedGeneralAction,
  getSuggestedGeneralActionReview,
  ignoreSuggestedGeneralAction,
  restoreDismissedSuggestedGeneralAction,
  type SuggestedGeneralActionReviewResult,
} from "@tendnote/db/queries/general-actions";
import type { GeneralActionEdit } from "@tendnote/domain";
import { z } from "zod";
import { parseDateInputValue } from "@/lib/followup-view";
import { runOwnerAction } from "@/lib/owner-action";
import {
  type SuggestedGeneralActionReviewView,
  toSuggestedGeneralActionReviewView,
} from "@/lib/suggested-general-action-review-view";

const actionSchema = z.object({ generalActionId: z.uuid() });

// One edit-validation path for both accept-with-edit and edit-in-place: trims the
// title/notes and resolves a `YYYY-MM-DD` due date to local midnight. The shared review
// layer re-validates; explicit `null` clears notes or the due date, absent leaves it.
const reviewEditInputSchema = z.object({
  title: z.string().trim().min(1).max(280).optional(),
  notes: z.string().trim().min(1).max(2000).nullable().optional(),
  dueAt: z.string().transform(parseDateInputValue).nullable().optional(),
});

/**
 * Builds the returned review view with the owner's Area names resolved, so an accepted
 * or edited proposal keeps its Area chip. Area names are owner-scoped and small.
 */
async function toView(
  ownerUserId: string,
  result: SuggestedGeneralActionReviewResult,
): Promise<SuggestedGeneralActionReviewView> {
  const areas = await listGeneralActionAreas({ ownerUserId, includeArchived: true });
  const areaNameById = new Map(areas.map((area) => [area.id, area.name]));
  return toSuggestedGeneralActionReviewView(result, { callerUserId: ownerUserId, areaNameById });
}

export async function acceptSuggestedGeneralActionAction(input: {
  generalActionId: string;
  edit?: { title?: string; notes?: string | null; dueAt?: string | null };
}) {
  return runOwnerAction({
    schema: actionSchema.extend({ edit: reviewEditInputSchema.optional() }),
    input,
    body: ({ ownerUserId, input: parsed }) =>
      acceptSuggestedGeneralAction({
        actorUserId: ownerUserId,
        generalActionId: parsed.generalActionId,
        edit: (parsed.edit ?? {}) as GeneralActionEdit,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, ownerUserId) => toView(ownerUserId, outcome.result),
  });
}

export async function editSuggestedGeneralActionAction(input: {
  generalActionId: string;
  edit: { title?: string; notes?: string | null; dueAt?: string | null };
}) {
  return runOwnerAction({
    schema: actionSchema.extend({ edit: reviewEditInputSchema }),
    input,
    body: ({ ownerUserId, input: parsed }) =>
      editSuggestedGeneralAction({
        actorUserId: ownerUserId,
        generalActionId: parsed.generalActionId,
        edit: parsed.edit as GeneralActionEdit,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, ownerUserId) => toView(ownerUserId, outcome.result),
  });
}

export async function dismissSuggestedGeneralActionAction(input: { generalActionId: string }) {
  return runOwnerAction({
    schema: actionSchema,
    input,
    body: async ({ ownerUserId, input: parsed }) => {
      const prior = await getSuggestedGeneralActionReview({
        actorUserId: ownerUserId,
        generalActionId: parsed.generalActionId,
      });
      if (!prior) throw new Error("Suggested action not found.");
      const outcome = await dismissSuggestedGeneralAction({
        actorUserId: ownerUserId,
        generalActionId: parsed.generalActionId,
      });
      return { outcome, prior };
    },
    affectedScopes: ({ outcome }) => outcome.affectedScopes,
    result: ({ outcome, prior }, ownerUserId) =>
      toView(ownerUserId, { ...prior, action: outcome.result }),
  });
}

export async function restoreDismissedSuggestedGeneralActionAction(input: {
  generalActionId: string;
}) {
  return runOwnerAction({
    schema: actionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      restoreDismissedSuggestedGeneralAction({
        actorUserId: ownerUserId,
        generalActionId: parsed.generalActionId,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome, ownerUserId) => toView(ownerUserId, outcome.result),
  });
}

export async function ignoreSuggestedGeneralActionAction(input: { generalActionId: string }) {
  return runOwnerAction({
    schema: actionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      ignoreSuggestedGeneralAction({
        actorUserId: ownerUserId,
        generalActionId: parsed.generalActionId,
      }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => ({
      generalActionId: outcome.result.id,
      status: outcome.result.status,
    }),
  });
}
