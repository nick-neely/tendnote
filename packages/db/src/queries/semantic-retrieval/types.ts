import type {
  CreateEmbeddingJobInput,
  CreateRelationshipContextEmbeddingInput,
  EmbeddingJob,
  EmbeddingJobStatus,
  Memory,
  ParsedSearchSemanticContextInput,
  RelationshipContextEmbedding,
  SemanticRecordKind,
  SemanticRetrievalResult,
  SourceRecord,
  SourceRecordPerson,
  UnresolvedPersonMention,
} from "@tendnote/domain";
import type { InMemoryMemoryStore, MemoryReviewStore } from "../memories/types";

export type EmbeddingAdapterInput = {
  text: string;
  model: string;
  version: string;
};

export type EmbeddingAdapterResult = {
  vector: number[];
  model: string;
  version: string;
};

export type EmbeddingAdapter = {
  embedText: (input: EmbeddingAdapterInput) => Promise<EmbeddingAdapterResult>;
};

export type EmbeddingConfig = {
  model: string;
  version: string;
};

export type SearchSemanticContextQueryInput = ParsedSearchSemanticContextInput & {
  ownerUserId: string;
};

export type UpdateEmbeddingJobInput = {
  jobId: string;
  status?: EmbeddingJobStatus;
  lastError?: string | null;
  runAfter?: Date;
  claimedAt?: Date | null;
  completedAt?: Date | null;
};

export type EmbeddingJobLifecycleStore = {
  createEmbeddingJob: (job: CreateEmbeddingJobInput) => Promise<EmbeddingJob>;
  findEmbeddingJobByIdempotencyKey: (idempotencyKey: string) => Promise<EmbeddingJob | null>;
  getEmbeddingJob: (jobId: string) => Promise<EmbeddingJob | null>;
  claimEmbeddingJob: (input: { jobId: string; now: Date }) => Promise<EmbeddingJob | null>;
  claimNextEmbeddingJob: (input: { now: Date }) => Promise<EmbeddingJob | null>;
  updateEmbeddingJob: (input: UpdateEmbeddingJobInput) => Promise<EmbeddingJob>;
};

export type EmbeddingStore = MemoryReviewStore &
  EmbeddingJobLifecycleStore & {
    listSourceRecordPeople: (input: {
      ownerUserId: string;
      sourceRecordId: string;
    }) => Promise<SourceRecordPerson[]>;
    listUnresolvedMentions: (input: {
      ownerUserId: string;
      sourceRecordId: string;
    }) => Promise<UnresolvedPersonMention[]>;
    upsertRelationshipContextEmbedding: (
      embedding: CreateRelationshipContextEmbeddingInput,
    ) => Promise<RelationshipContextEmbedding>;
    findRelationshipContextEmbedding: (input: {
      ownerUserId: string;
      recordKind: SemanticRecordKind;
      recordId: string;
      embeddingModel: string;
      embeddingVersion: string;
    }) => Promise<RelationshipContextEmbedding | null>;
    searchSemanticContext: (
      input: SearchSemanticContextQueryInput & {
        queryEmbedding: number[];
        embeddingModel: string;
        embeddingVersion: string;
      },
    ) => Promise<SemanticRetrievalResult[]>;
  };

export type InMemoryEmbeddingStore = Omit<
  InMemoryMemoryStore,
  "listSourceRecordPeople" | "listUnresolvedMentions"
> &
  EmbeddingStore & {
    listEmbeddingJobs: () => Promise<EmbeddingJob[]>;
    listRelationshipContextEmbeddings: () => Promise<RelationshipContextEmbedding[]>;
  };

export type EnqueueEmbeddingJobInput = {
  ownerUserId: string;
  recordKind: SemanticRecordKind;
  recordId: string;
  runAfter?: Date;
};

export type EnqueueEmbeddingJobResult = {
  job: EmbeddingJob;
  created: boolean;
};

export type ProcessEmbeddingJobInput = {
  jobId: string;
  now?: Date;
  claim?: boolean;
  retryDelayMs?: number;
};

export type ClaimEmbeddingJobInput = {
  jobId: string;
  now?: Date;
};

export type ProcessEmbeddingJobOutcome = "not_claimable" | "skipped" | "completed" | "failed";

export type ProcessEmbeddingJobResult = {
  job: EmbeddingJob;
  outcome: ProcessEmbeddingJobOutcome;
  embedding: RelationshipContextEmbedding | null;
  sourceMemory?: Memory | null;
  reason?: string;
  error?: string;
  sourceRecord?: SourceRecord | null;
};
