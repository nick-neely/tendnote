import type {
  Followup,
  Memory,
  Person,
  PrivacyScope,
  SemanticRetrievalResult,
  Sensitivity,
  SourceRecord,
  VisibilityChoice,
} from "@tendnote/domain";

export type RelationshipAgendaKind =
  | "due_followup"
  | "birthday"
  | "review_item"
  | "recent_context"
  | "semantic_context"
  | "suggested_followup";

export type RelationshipAgendaTrustLevel =
  | "active_reminder"
  | "stored_profile_data"
  | "logged_context"
  | "confirmed_fact"
  | "tentative";

export type RelationshipAgendaSourceRef = {
  kind: "followup" | "person" | "memory" | "source_record";
  id: string;
};

export type RelationshipAgendaSourceRecordReview = {
  sourceRecord: SourceRecord;
  linkedPeople: Pick<Person, "id" | "displayName">[];
};

export type RelationshipAgendaCandidate = {
  kind: RelationshipAgendaKind;
  personId: string | null;
  personDisplayName: string | null;
  title: string;
  reason: string;
  dueAt?: Date;
  sourceRefs: RelationshipAgendaSourceRef[];
  trustLevel: RelationshipAgendaTrustLevel;
  sensitivity: Sensitivity;
  visibilityChoice?: VisibilityChoice;
  visibilityLabel?: string;
  /**
   * Disclosure scope of the backing record, carried through so downstream
   * aggregation (scheduled-workflow delivery scope) can decide whether an artifact
   * is household-safe. Omitted for candidates with no scoped backing record (e.g.
   * person-derived birthdays), which fail closed to `private`.
   */
  scope?: PrivacyScope;
  /** Household the backing record belongs to, paired with a `household` scope. */
  householdId?: string | null;
  rank: number;
};

export type RelationshipAgendaInput = {
  ownerUserId: string;
  windowStart: Date;
  windowEnd: Date;
  query?: string;
  limit?: number;
  includeKinds?: RelationshipAgendaKind[];
  directlyRequested?: boolean;
};

export type RelationshipAgendaStore = {
  listActiveFollowupsForOwner: (input: {
    ownerUserId: string;
    dueBefore?: Date;
    limit?: number;
  }) => Promise<Followup[]>;
  listVisibleActiveFollowups: (input: {
    callerUserId: string;
    dueBefore?: Date;
    limit?: number;
  }) => Promise<Followup[]>;
  getPerson: (input: { ownerUserId: string; personId: string }) => Promise<Person | null>;
  listPeople: (input: { ownerUserId: string }) => Promise<Person[]>;
  getSourceRecord: (input: {
    ownerUserId: string;
    sourceRecordId: string;
  }) => Promise<SourceRecord | null>;
  listSuggestedMemoriesForOwner: (input: {
    ownerUserId: string;
    limit?: number;
  }) => Promise<Memory[]>;
  listVisibleSuggestedMemories: (input: {
    callerUserId: string;
    limit?: number;
  }) => Promise<Memory[]>;
  listSuggestedFollowupsForOwner: (input: {
    ownerUserId: string;
    limit?: number;
  }) => Promise<Followup[]>;
  listVisibleSuggestedFollowups: (input: {
    callerUserId: string;
    limit?: number;
  }) => Promise<Followup[]>;
  listSourceRecordReviewsForOwner: (input: {
    ownerUserId: string;
    limit?: number;
  }) => Promise<RelationshipAgendaSourceRecordReview[]>;
  listVisibleSourceRecordReviews: (input: {
    callerUserId: string;
    limit?: number;
  }) => Promise<RelationshipAgendaSourceRecordReview[]>;
  listRecentSourceRecordsForOwner: (input: {
    ownerUserId: string;
    limit?: number;
  }) => Promise<RelationshipAgendaSourceRecordReview[]>;
  listVisibleRecentSourceRecords: (input: {
    callerUserId: string;
    limit?: number;
  }) => Promise<RelationshipAgendaSourceRecordReview[]>;
  searchSemanticContext: (input: {
    ownerUserId: string;
    query: string;
    limit?: number;
    directlyRequested?: boolean;
  }) => Promise<SemanticRetrievalResult[]>;
};
