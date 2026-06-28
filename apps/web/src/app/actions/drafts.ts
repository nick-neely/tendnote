"use server";

import {
  approveDraft,
  dismissDraft,
  editDraftBody,
  type GenerateDraftOutcome,
  getDraft,
  markDraftSentManually,
  regenerateDraft,
} from "@tendnote/db/queries/drafts";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentOwnerUserId } from "@/lib/auth/current-user";
import { type DraftView, toDraftView } from "@/lib/draft-view";

const draftActionSchema = z.object({ draftId: z.uuid() });
const editDraftSchema = z.object({ draftId: z.uuid(), body: z.string().trim().min(1) });

/**
 * Owner-scoped draft lifecycle actions for the review surface (PRD #75, issue #78).
 * Each resolves the signed-in owner, calls the shared audited db lifecycle, and
 * revalidates the person profile. None of these send, schedule, or create anything
 * externally — every action stays inside Tendnote.
 */
export async function approveDraftAction(input: { draftId: string }): Promise<DraftView> {
  const { draftId } = draftActionSchema.parse(input);
  const ownerUserId = await getCurrentOwnerUserId();
  const draft = await approveDraft({ ownerUserId, draftId });

  revalidatePath(`/people/${draft.personId}`);
  return toDraftView(draft);
}

export async function dismissDraftAction(input: { draftId: string }): Promise<DraftView> {
  const { draftId } = draftActionSchema.parse(input);
  const ownerUserId = await getCurrentOwnerUserId();
  const draft = await dismissDraft({ ownerUserId, draftId });

  revalidatePath(`/people/${draft.personId}`);
  return toDraftView(draft);
}

/**
 * Records that the user sent the message themselves. This never sends anything —
 * it only marks the draft so Tendnote can remember the user acted (PRD user story
 * #10).
 */
export async function markDraftSentManuallyAction(input: { draftId: string }): Promise<DraftView> {
  const { draftId } = draftActionSchema.parse(input);
  const ownerUserId = await getCurrentOwnerUserId();
  const draft = await markDraftSentManually({ ownerUserId, draftId });

  revalidatePath(`/people/${draft.personId}`);
  return toDraftView(draft);
}

/** Edits the draft body while preserving the persisted source-reference grounding. */
export async function editDraftBodyAction(input: {
  draftId: string;
  body: string;
}): Promise<DraftView> {
  const { draftId, body } = editDraftSchema.parse(input);
  const ownerUserId = await getCurrentOwnerUserId();
  const draft = await editDraftBody({ ownerUserId, draftId, body });

  revalidatePath(`/people/${draft.personId}`);
  return toDraftView(draft);
}

/**
 * Reads the authoritative persisted draft for the in-chat draft card (ADR-0028).
 * Eve's tool output is snapshotted into the chat transcript, so on a later visit it
 * replays the body as first generated; hydrating by id lets the card show the live
 * record instead — reflecting an inline edit or a lifecycle change made on the
 * person page. Owner-scoped and read-only; returns null if the draft is gone.
 */
export async function getDraftViewAction(input: { draftId: string }): Promise<DraftView | null> {
  const { draftId } = draftActionSchema.parse(input);
  const ownerUserId = await getCurrentOwnerUserId();
  const draft = await getDraft({ ownerUserId, draftId });

  return draft ? toDraftView(draft) : null;
}

export type RegenerateDraftResult = {
  outcome: GenerateDraftOutcome["status"];
  draft: DraftView | null;
};

/**
 * Explicitly regenerates a draft as a new record (PRD user story #22). The prior
 * draft is left untouched, so reviewed text is never silently replaced. A skipped
 * outcome (e.g. thin context) returns no draft so the UI can explain it.
 */
export async function regenerateDraftAction(input: {
  draftId: string;
}): Promise<RegenerateDraftResult> {
  const { draftId } = draftActionSchema.parse(input);
  const ownerUserId = await getCurrentOwnerUserId();
  const outcome = await regenerateDraft({ ownerUserId, draftId });

  if (outcome.status === "created") {
    revalidatePath(`/people/${outcome.draft.personId}`);
    return { outcome: outcome.status, draft: toDraftView(outcome.draft) };
  }

  return { outcome: outcome.status, draft: null };
}
