import type {
  CreateFollowupInput,
  Followup,
  FollowupEdit,
  Person,
  SourceRecord,
} from "@tendnote/domain";
import type { HouseholdStore } from "../households/types";
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
export type FollowupLifecyclePatch = FollowupUpdatePatch &
  Partial<Pick<Followup, "lastActorUserId">>;

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
  getVisibleFollowup: (input: {
    callerUserId: string;
    followupId: string;
  }) => Promise<Followup | null>;
  updateFollowup: (input: {
    ownerUserId: string;
    followupId: string;
    patch: FollowupLifecyclePatch;
  }) => Promise<Followup>;
  listActiveFollowupsForOwner: (input: {
    ownerUserId: string;
    personId?: string;
    dueBefore?: Date;
    limit?: number;
  }) => Promise<Followup[]>;
  listVisibleActiveFollowups: (input: {
    callerUserId: string;
    personId?: string;
    dueBefore?: Date;
    limit?: number;
  }) => Promise<Followup[]>;
  listVisibleFollowups: (input: {
    callerUserId: string;
    includeArchived: boolean;
    limit?: number;
  }) => Promise<Followup[]>;
  listSuggestedFollowupsForOwner: (input: {
    ownerUserId: string;
    personId?: string;
    limit?: number;
  }) => Promise<Followup[]>;
  listVisibleSuggestedFollowups: (input: {
    callerUserId: string;
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
  Pick<SourceRecordResolutionStore, "getPerson" | "getSourceRecord" | "createAuditLogEntry"> &
  Pick<
    HouseholdStore,
    | "getHouseholdMembership"
    | "listHouseholdMemberships"
    | "createHouseholdRecordShare"
    | "listHouseholdRecordShares"
  >;

export type InMemoryFollowupLifecycleStore = InMemorySourceRecordStore &
  FollowupStore &
  HouseholdStore;

export type CreateActiveFollowupInput = {
  /** Optional stable id for idempotent cross-domain Capture. */
  id?: string;
  ownerUserId: string;
  personId: string;
  reason: string;
  dueAt: Date;
  cadence?: string | null;
  /** Optional owner-visible source grounding, required by source-first Capture. */
  sourceRecordId?: string | null;
  householdId?: string | null;
  scope?: "private" | "shared" | "household";
  selectedUserIds?: string[];
};

export type FollowupActionInput = {
  /** The acting user, not necessarily the owner. For a private follow-up this is the
   * owner; for a shared/household one it may be any member who can see it. Owner keying
   * happens internally off the loaded record — this field only names who is acting. */
  actorUserId: string;
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
  // True only when the user directly asked about this (delicate) context. Restricted
  // source records are excluded from proactive suggestion by default; this opt-in
  // lets a direct request still ground one (PRD #42, ADR-0058).
  directlyRequested?: boolean;
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
