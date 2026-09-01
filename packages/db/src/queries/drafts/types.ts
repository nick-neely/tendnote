import type { CreateMessageDraftInput, MessageDraft, MessageDraftStatus } from "@tendnote/domain";
import type {
  InMemorySourceRecordStore,
  SourceRecordResolutionStore,
} from "../source-records/types";

/** Bounded patch the lifecycle layer may apply to a persisted draft (issue #78). */
export type MessageDraftPatch = Partial<Pick<MessageDraft, "body" | "status">>;

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
  // contract is never mutated here (PRD: editing body preserves grounding).
  //
  // `revertApprovalToDraft` closes a TOCTOU on the stale-approval fix (security):
  // when set, the store atomically forces `status = draft` iff the row is CURRENTLY
  // `approved`, in the SAME statement as the patch — never from a prior read — so a
  // concurrent approval cannot survive a body edit and carry unreviewed text out to
  // Gmail. Only `approved -> draft`; `dismissed`/`sent_manually`/`draft` are left as
  // they are. The returned draft reflects the persisted status, so callers derive
  // whether a reversion happened from it.
  updateDraft: (input: {
    ownerUserId: string;
    draftId: string;
    patch: MessageDraftPatch;
    revertApprovalToDraft?: boolean;
  }) => Promise<MessageDraft>;
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
