import type { CreateMessageDraftInput, MessageDraft, MessageDraftStatus } from "@tendnote/domain";
import type {
  InMemorySourceRecordStore,
  SourceRecordResolutionStore,
} from "../source-records/types";

/** Bounded patch the lifecycle layer may apply to a persisted draft (issue #78). */
export type MessageDraftPatch = Partial<Pick<MessageDraft, "body" | "status">>;

/**
 * A bounded update against one owner-scoped draft row.
 *
 * `revertApprovalToDraft` and `expectedBody` are the two atomic concurrency guards
 * for the stale-approval class of bug (security). They are independent: the edit
 * side sets the former, the approve side sets the latter, and neither surface uses
 * both at once.
 *
 * - `revertApprovalToDraft` (edit side): force `status = draft` iff the row is
 *   CURRENTLY `approved`, in the SAME statement as the patch, so a concurrent
 *   approval cannot survive a body edit.
 * - `expectedBody` (approve side): apply the patch ONLY IF the row's CURRENT body
 *   still equals this value. It is the optimistic-concurrency guard that binds an
 *   approval to the exact body it was granted against: if a concurrent edit changed
 *   the body since the approve read it, the guarded statement matches no row and the
 *   store returns `null`, so the approve is refused instead of stamping `approved`
 *   onto text the user never reviewed and letting the Gmail gate export it.
 */
export type UpdateDraftInput = {
  ownerUserId: string;
  draftId: string;
  patch: MessageDraftPatch;
  revertApprovalToDraft?: boolean;
  expectedBody?: string;
};

/**
 * Postgres-owned persistence seam for Tendnote message drafts (PRD #75, issue
 * #76). This is the shared foundation every later slice calls — the generator
 * (#77), the web review surface (#78), and the Eve tools (#80) — so no surface
 * forks draft storage. Source references are persisted with the draft as the
 * grounding contract (ADR-0040), owner-scoped like the draft itself, and
 * snapshotted so a draft stays explainable after the underlying records change.
 */
export type DraftStore = {
  // Persists a draft with its source references. Source refs travel with the
  // draft row, so they are owner-scoped by construction and cannot be read or
  // written across owners.
  createDraft: (input: CreateMessageDraftInput) => Promise<MessageDraft>;
  getDraft: (input: { ownerUserId: string; draftId: string }) => Promise<MessageDraft | null>;
  // Drafts for a person, newest first, so the review UI can surface prior
  // writing attempts (PRD user story #35). Optional status filter.
  listDraftsForPerson: (input: {
    ownerUserId: string;
    personId: string;
    statuses?: MessageDraftStatus[];
  }) => Promise<MessageDraft[]>;
  // The owner's drafts, newest first, for internal/audit reads. Optional status
  // filter. Never used to fork render-time reads, which target a person.
  listDraftsForOwner: (input: {
    ownerUserId: string;
    statuses?: MessageDraftStatus[];
  }) => Promise<MessageDraft[]>;
  // Applies a bounded body/status patch. The persisted source-reference grounding
  // contract is never mutated here (PRD: editing body preserves grounding). See
  // `UpdateDraftInput` for the two atomic concurrency guards.
  //
  // Overloaded on the `expectedBody` optimistic-concurrency guard: without it the
  // update either succeeds or throws the not-found sentinel (unchanged behaviour);
  // WITH it, a `null` return means the guard excluded the row — the draft's body
  // changed since it was read — which the caller must surface as a re-review refusal
  // rather than as a missing record. Every existing (unguarded) caller keeps a
  // non-null `MessageDraft`.
  updateDraft: {
    (input: UpdateDraftInput & { expectedBody: string }): Promise<MessageDraft | null>;
    (input: UpdateDraftInput): Promise<MessageDraft>;
  };
};

/**
 * Draft lifecycle store: the draft persistence seam plus the person/source/audit
 * surface the generator and lifecycle actions need. Mirrors the brief lifecycle
 * store composition (PRD #65) so web and Eve callers share one lifecycle layer
 * and every owner-scoped draft action is audited.
 */
export type DraftLifecycleStore = DraftStore &
  Pick<SourceRecordResolutionStore, "getPerson" | "getSourceRecord" | "createAuditLogEntry">;

export type InMemoryDraftLifecycleStore = InMemorySourceRecordStore & DraftStore;
