"use server";

import { listGeneralActionAreas } from "@tendnote/db/queries/general-action-areas";
import {
  acceptSuggestedGeneralAction,
  dismissSuggestedGeneralAction,
  editSuggestedGeneralAction,
  ignoreSuggestedGeneralAction,
  type SuggestedGeneralActionReviewResult,
} from "@tendnote/db/queries/general-actions";
import type { GeneralActionEdit } from "@tendnote/domain";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { parseDateInputValue } from "@/lib/followup-view";
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

function parseReviewEdit(
  edit: { title?: string; notes?: string | null; dueAt?: string | null } = {},
): GeneralActionEdit {
  const parsed = reviewEditInputSchema.parse(edit);
  return {
    ...(parsed.title !== undefined ? { title: parsed.title } : {}),
    ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
    ...(parsed.dueAt !== undefined ? { dueAt: parsed.dueAt } : {}),
  };
}

export type SuggestedGeneralActionResolution = {
  generalActionId: string;
  status: string;
};

/** Re-render the Actions surface and the dashboard rail so both review surfaces agree. */
function revalidateReviewSurfaces() {
  revalidatePath("/actions");
  revalidatePath("/");
}

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
}): Promise<SuggestedGeneralActionReviewView> {
  const { generalActionId } = actionSchema.parse({ generalActionId: input.generalActionId });
  const edit = parseReviewEdit(input.edit);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const result = await acceptSuggestedGeneralAction({ ownerUserId, generalActionId, edit });

  revalidateReviewSurfaces();
  return toView(ownerUserId, result);
}

export async function editSuggestedGeneralActionAction(input: {
  generalActionId: string;
  edit: { title?: string; notes?: string | null; dueAt?: string | null };
}): Promise<SuggestedGeneralActionReviewView> {
  const { generalActionId } = actionSchema.parse({ generalActionId: input.generalActionId });
  const edit = parseReviewEdit(input.edit);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const result = await editSuggestedGeneralAction({ ownerUserId, generalActionId, edit });

  revalidateReviewSurfaces();
  return toView(ownerUserId, result);
}

export async function dismissSuggestedGeneralActionAction(input: {
  generalActionId: string;
}): Promise<SuggestedGeneralActionResolution> {
  const { generalActionId } = actionSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const action = await dismissSuggestedGeneralAction({ ownerUserId, generalActionId });

  revalidateReviewSurfaces();
  return { generalActionId: action.id, status: action.status };
}

export async function ignoreSuggestedGeneralActionAction(input: {
  generalActionId: string;
}): Promise<SuggestedGeneralActionResolution> {
  const { generalActionId } = actionSchema.parse(input);
  const ownerUserId = await requireAdmittedOwnerForAction();
  const action = await ignoreSuggestedGeneralAction({ ownerUserId, generalActionId });

  revalidateReviewSurfaces();
  return { generalActionId: action.id, status: action.status };
}
