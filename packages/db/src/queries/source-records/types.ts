import type {
  Confidence,
  CreateSourceRecordInput,
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
  unresolvedMentions?: UnresolvedPersonMention[];
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
  createSourceRecord: (sourceRecord: CreateSourceRecordInput) => Promise<SourceRecord>;
  getSourceRecord: (input: GetSourceRecordReviewInput) => Promise<SourceRecord | null>;
  /**
   * Evidence read by current visibility rather than by owner.
   *
   * Owner-keyed reads cannot answer "may this member see this grounding?" for
   * anything they did not capture, and the two cases that matter are exactly the
   * Household ones: a household-native record's evidence, which the whole
   * household holds, and another member's evidence deliberately shared with
   * them. Proof-gated, so a member who lost access reads nothing (ADR 0219).
   */
  getVisibleSourceRecord: (input: {
    callerUserId: string;
    sourceRecordId: string;
  }) => Promise<SourceRecord | null>;
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
  listUnresolvedMentions: (input: {
    sourceRecordId: string;
    ownerUserId?: string;
  }) => Promise<UnresolvedPersonMention[]>;
  createAuditLogEntry: (
    auditLogEntry: Omit<SourceRecordAuditLogEntry, "id" | "createdAt"> &
      Partial<Pick<SourceRecordAuditLogEntry, "id">>,
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
  unlinkSourceRecordPerson: (input: { sourceRecordId: string; personId: string }) => Promise<void>;
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
  listAuditLogEntries: (input: { ownerUserId: string }) => Promise<SourceRecordAuditLogEntry[]>;
};

export type SourceRecordEmbeddingScheduler = (input: {
  ownerUserId: string;
  recordKind: "source_record";
  recordId: string;
}) => Promise<unknown>;

export type InMemorySourceRecordStore = SourceRecordResolutionStore & {
  getSourceRecordById: (sourceRecordId: string) => Promise<SourceRecord | null>;
  listPeople: (input: { ownerUserId: string }) => Promise<Person[]>;
  listSourceRecordPeople: (input: { sourceRecordId: string }) => Promise<SourceRecordPerson[]>;
};
