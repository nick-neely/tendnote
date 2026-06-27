import type {
  Followup,
  Memory,
  Person,
  SemanticRetrievalResult,
  Sensitivity,
  SourceRecord,
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
  listSuggestedFollowupsForOwner: (input: {
    ownerUserId: string;
    limit?: number;
  }) => Promise<Followup[]>;
  listSourceRecordReviewsForOwner: (input: {
    ownerUserId: string;
    limit?: number;
  }) => Promise<RelationshipAgendaSourceRecordReview[]>;
  listRecentSourceRecordsForOwner: (input: {
    ownerUserId: string;
    limit?: number;
  }) => Promise<RelationshipAgendaSourceRecordReview[]>;
  searchSemanticContext: (input: {
    ownerUserId: string;
    query: string;
    limit?: number;
    directlyRequested?: boolean;
  }) => Promise<SemanticRetrievalResult[]>;
};
