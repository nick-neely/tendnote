import type {
  Confidence,
  Person,
  Sensitivity,
  Source,
  SourceRecord,
  SourceRecordPerson,
  SourceRecordPersonRole,
  SourceRecordStatus,
  UnresolvedPersonMention,
} from "@tendnote/domain";

export type SourceRecordReviewComponent = {
  type: "source_record_review";
  sourceRecordId: string;
};

export type CaptureSourceRecordInput = {
  ownerUserId: string;
  retainedContent: string;
  sourceType?: Source;
  status?: SourceRecordStatus;
  confidence?: Confidence;
  sensitivity?: Sensitivity;
  metadataJson?: Record<string, unknown>;
  unresolvedMentions?: Array<{
    mentionText: string;
    candidatePersonIds?: string[];
  }>;
};

export type CaptureSourceRecordResult = {
  sourceRecord: SourceRecord;
  component: SourceRecordReviewComponent;
};

export type GetSourceRecordReviewInput = {
  ownerUserId: string;
  sourceRecordId: string;
};

export type ListSourceRecordReviewsInput = {
  ownerUserId: string;
  limit?: number;
};

export type SourceRecordReviewResult = {
  sourceRecord: SourceRecord;
  component: SourceRecordReviewComponent;
  linkedPeople?: Pick<Person, "id" | "displayName">[];
};

export type SourceRecordAuditLogEntry = {
  id: string;
  ownerUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadataJson: Record<string, unknown>;
  createdAt: Date;
};

export type CreateResolutionPersonInput = Omit<Person, "id" | "createdAt" | "updatedAt">;

export type CreateUnresolvedMentionInput = Omit<
  UnresolvedPersonMention,
  "id" | "createdAt" | "resolvedAt" | "status" | "resolvedPersonId"
> &
  Partial<Pick<UnresolvedPersonMention, "status" | "resolvedPersonId" | "resolvedAt">>;

export type SourceRecordCaptureStore = {
  createSourceRecord: (
    sourceRecord: Omit<SourceRecord, "id" | "createdAt" | "updatedAt">,
  ) => Promise<SourceRecord>;
  getSourceRecord: (input: GetSourceRecordReviewInput) => Promise<SourceRecord | null>;
  updateSourceRecordStatus: (input: {
    ownerUserId: string;
    sourceRecordId: string;
    status: SourceRecordStatus;
  }) => Promise<SourceRecord>;
  /** Replace a source record's metadata blob (callers merge before passing it in). */
  updateSourceRecordMetadata: (input: {
    ownerUserId: string;
    sourceRecordId: string;
    metadataJson: Record<string, unknown>;
  }) => Promise<SourceRecord>;
  createUnresolvedMention: (
    unresolvedMention: CreateUnresolvedMentionInput,
  ) => Promise<UnresolvedPersonMention>;
  createAuditLogEntry: (
    auditLogEntry: Omit<SourceRecordAuditLogEntry, "id" | "createdAt">,
  ) => Promise<SourceRecordAuditLogEntry>;
};

export type SourceRecordResolutionStore = SourceRecordCaptureStore & {
  createPerson: (person: CreateResolutionPersonInput) => Promise<Person>;
  getPerson: (input: { ownerUserId: string; personId: string }) => Promise<Person | null>;
  findPeopleByDisplayName: (input: {
    ownerUserId: string;
    mentionText: string;
    limit?: number;
  }) => Promise<Person[]>;
  linkSourceRecordPerson: (input: {
    sourceRecordId: string;
    personId: string;
    role: SourceRecordPersonRole;
  }) => Promise<SourceRecordPerson>;
  listSourceRecordsForPersonContext: (input: {
    ownerUserId: string;
    personId: string;
  }) => Promise<SourceRecord[]>;
  resolveUnresolvedMention: (input: {
    sourceRecordId: string;
    unresolvedMentionId: string;
    personId: string;
  }) => Promise<UnresolvedPersonMention>;
  dismissUnresolvedMention: (input: {
    sourceRecordId: string;
    unresolvedMentionId: string;
  }) => Promise<UnresolvedPersonMention>;
};

export type SourceRecordEmbeddingScheduler = (input: {
  ownerUserId: string;
  recordKind: "source_record";
  recordId: string;
}) => Promise<unknown>;

export type InMemorySourceRecordStore = SourceRecordResolutionStore & {
  getSourceRecordById: (sourceRecordId: string) => Promise<SourceRecord | null>;
  listPeople: (input: { ownerUserId: string }) => Promise<Person[]>;
  listUnresolvedMentions: (input: { sourceRecordId: string }) => Promise<UnresolvedPersonMention[]>;
  listSourceRecordPeople: (input: { sourceRecordId: string }) => Promise<SourceRecordPerson[]>;
  listAuditLogEntries: (input: { ownerUserId: string }) => Promise<SourceRecordAuditLogEntry[]>;
};
