import type {
  CreateFollowupInput,
  Followup,
  FollowupEdit,
  Person,
  SourceRecord,
} from "@tendnote/domain";
import type {
  InMemorySourceRecordStore,
  SourceRecordResolutionStore,
} from "../source-records/types";

/** Person summary used to name a follow-up's person without leaking raw ids. */
export type FollowupPersonRef = Pick<Person, "id" | "displayName">;

/** An active follow-up paired with its (owner-scoped) person, for the dashboard. */
export type ActiveFollowupSummary = {
  followup: Followup;
  person: FollowupPersonRef | null;
};

/**
 * Read-only follow-up surface the snapshot read path depends on. It returns the
 * owner's follow-ups for a person; the snapshot builder selects the eligible ones
 * (active or recently completed) via domain policy. The read seam is intentionally
 * read-only — follow-up lifecycle stays owned by follow-up records, not the
 * snapshot cache (ADR 0009, PRD #11).
 */
export type FollowupContextStore = {
  listFollowupsForPerson: (input: { ownerUserId: string; personId: string }) => Promise<Followup[]>;
};

/** Bounded patch the lifecycle layer may apply to a persisted follow-up. */
export type FollowupUpdatePatch = Partial<Pick<Followup, "reason" | "dueAt" | "status">>;

/**
 * Full follow-up store: the read surface plus follow-up creation, single-record
 * reads, and bounded updates. The bundled stores implement this; only the read
 * surface is exposed to the snapshot path. It deliberately carries no person or
 * audit methods so it can be spread into the composed snapshot store without
 * shadowing those (PRD #11).
 */
export type FollowupStore = FollowupContextStore & {
  createFollowup: (input: CreateFollowupInput) => Promise<Followup>;
  getFollowup: (input: { ownerUserId: string; followupId: string }) => Promise<Followup | null>;
  updateFollowup: (input: {
    ownerUserId: string;
    followupId: string;
    patch: FollowupUpdatePatch;
  }) => Promise<Followup>;
  listActiveFollowupsForOwner: (input: {
    ownerUserId: string;
    personId?: string;
    dueBefore?: Date;
    limit?: number;
  }) => Promise<Followup[]>;
  listSuggestedFollowupsForOwner: (input: {
    ownerUserId: string;
    personId?: string;
    limit?: number;
  }) => Promise<Followup[]>;
};

/**
 * Shared owner-scoped store surface for the follow-up lifecycle service. It adds
 * person resolution, source-record grounding, and audit logging on top of the
 * follow-up CRUD store, mirroring how the memory review store is composed so web
 * and Eve callers share one lifecycle layer (PRD #42).
 */
export type FollowupLifecycleStore = FollowupStore &
  Pick<SourceRecordResolutionStore, "getPerson" | "getSourceRecord" | "createAuditLogEntry">;

export type InMemoryFollowupLifecycleStore = InMemorySourceRecordStore & FollowupStore;

export type CreateActiveFollowupInput = {
  ownerUserId: string;
  personId: string;
  reason: string;
  dueAt: Date;
  cadence?: string | null;
};

export type FollowupActionInput = {
  ownerUserId: string;
  followupId: string;
};

export type EditFollowupInput = FollowupActionInput & {
  edit: FollowupEdit;
};

export type SnoozeFollowupInput = FollowupActionInput & {
  dueAt: Date;
};

/** Fixed typed component for a suggested follow-up review item (ADR-0027/0028). */
export type SuggestedFollowupReviewComponent = {
  type: "suggested_followup_review";
  followupId: string;
  sourceRecordId: string | null;
};

/**
 * A suggested follow-up presented for review: the persisted follow-up plus its
 * resolved person and grounding source record, so review surfaces name people and
 * show where the proposal came from instead of leaking raw ids (ADR-0028).
 */
export type SuggestedFollowupReviewResult = {
  followup: Followup;
  person: FollowupPersonRef | null;
  sourceRecord: SourceRecord | null;
  component: SuggestedFollowupReviewComponent;
};

export type SuggestFollowupInput = {
  ownerUserId: string;
  personId: string;
  reason: string;
  dueAt: Date;
  // The source record grounding the suggestion (logged context, captured
  // conversation, or a record standing in for an approved memory / retrieval
  // result). Required — suggestions must be grounded (PRD #42, ADR-0006).
  sourceRecordId: string;
};

export type ListSuggestedFollowupReviewsInput = {
  ownerUserId: string;
  personId?: string;
  limit?: number;
};

export type AcceptSuggestedFollowupInput = FollowupActionInput & {
  edit?: FollowupEdit;
};

export type EditSuggestedFollowupInput = FollowupActionInput & {
  edit: FollowupEdit;
};
