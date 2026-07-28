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
import { z } from "zod";
import { type DraftView, toDraftView } from "@/lib/draft-view";
import { runOwnerAction } from "@/lib/owner-action";

const draftActionSchema = z.object({ draftId: z.uuid() });
const editDraftSchema = z.object({ draftId: z.uuid(), body: z.string().trim().min(1) });

/**
 * Owner-scoped draft lifecycle actions for the review surface (PRD #75, issue #78).
 * Each resolves the signed-in owner, calls the shared audited db lifecycle, and
 * revalidates the person profile. None of these send, schedule, or create anything
 * externally — every action stays inside Tendnote.
 */
export async function approveDraftAction(input: { draftId: string }) {
  return runDraftMutation(input, approveDraft);
}

export async function dismissDraftAction(input: { draftId: string }) {
  return runDraftMutation(input, dismissDraft);
}

/**
 * Records that the user sent the message themselves. This never sends anything —
 * it only marks the draft so Tendnote can remember the user acted (PRD user story
 * #10).
 */
export async function markDraftSentManuallyAction(input: { draftId: string }) {
  return runDraftMutation(input, markDraftSentManually);
}

function runDraftMutation(input: { draftId: string }, mutate: typeof approveDraft) {
  return runOwnerAction({
    schema: draftActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) => mutate({ ownerUserId, draftId: parsed.draftId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => toDraftView(outcome.result),
  });
}

/** Edits the draft body while preserving the persisted source-reference grounding. */
export async function editDraftBodyAction(input: { draftId: string; body: string }) {
  return runOwnerAction({
    schema: editDraftSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      editDraftBody({ ownerUserId, draftId: parsed.draftId, body: parsed.body }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => toDraftView(outcome.result),
  });
}

/**
 * Reads the authoritative persisted draft for the in-chat draft card (ADR-0028).
 * Eve's tool output is snapshotted into the chat transcript, so on a later visit it
 * replays the body as first generated; hydrating by id lets the card show the live
 * record instead — reflecting an inline edit or a lifecycle change made on the
 * person page. Owner-scoped and read-only; returns null if the draft is gone.
 */
export async function getDraftViewAction(input: { draftId: string }) {
  return runOwnerAction({
    schema: draftActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) => getDraft({ ownerUserId, draftId: parsed.draftId }),
    result: (draft) => (draft ? toDraftView(draft) : null),
  });
}

type RegenerateDraftResult = {
  outcome: GenerateDraftOutcome["status"];
  draft: DraftView | null;
};

/**
 * Explicitly regenerates a draft as a new record (PRD user story #22). The prior
 * draft is left untouched, so reviewed text is never silently replaced. A skipped
 * outcome (e.g. thin context) returns no draft so the UI can explain it.
 */
export async function regenerateDraftAction(input: { draftId: string }) {
  return runOwnerAction({
    schema: draftActionSchema,
    input,
    body: ({ ownerUserId, input: parsed }) =>
      regenerateDraft({ ownerUserId, draftId: parsed.draftId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome): RegenerateDraftResult =>
      outcome.result.status === "created"
        ? { outcome: outcome.result.status, draft: toDraftView(outcome.result.draft) }
        : { outcome: outcome.result.status, draft: null },
  });
}
