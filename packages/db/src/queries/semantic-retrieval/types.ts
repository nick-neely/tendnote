import type {
  Asset,
  AssetMemory,
  CreateAssetInput,
  CreateAssetMemoryInput,
  CreateEmbeddingJobInput,
  CreateGeneralActionInput,
  CreateRelationshipContextEmbeddingInput,
  EmbeddingJob,
  EmbeddingJobStatus,
  GeneralAction,
  Memory,
  ParsedSearchSemanticContextInput,
  RelationshipContextEmbedding,
  SearchSemanticContextInput,
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

/**
 * The unparsed request shape for the semantic-retrieval entry points (the queries layer
 * and the public wrapper): a caller supplies the raw {@link SearchSemanticContextInput}
 * plus their owner id and the schema fills defaults (limit, minimumSimilarity,
 * directlyRequested, includeReviewGated). The store method keeps the parsed
 * {@link SearchSemanticContextQueryInput}, so defaults are always resolved by the time a
 * store runs the query.
 */
export type SearchSemanticContextRequest = SearchSemanticContextInput & {
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
    getGeneralActionForEmbedding: (input: {
      ownerUserId: string;
      generalActionId: string;
    }) => Promise<GeneralAction | null>;
    getAssetForEmbedding: (input: {
      ownerUserId: string;
      assetId: string;
    }) => Promise<Asset | null>;
    /**
     * The memory *and* the asset it hangs off, in one read: the embedded text folds in
     * the asset's name and kind (so "the kitchen fridge" can reach the fridge's filter
     * size), and the embed decision needs the asset's status (a fact about an
     * un-reviewed asset must not become retrievable).
     */
    getAssetMemoryForEmbedding: (input: {
      ownerUserId: string;
      assetMemoryId: string;
    }) => Promise<{ memory: AssetMemory; asset: Asset } | null>;
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
    createGeneralAction: (input: CreateGeneralActionInput) => Promise<GeneralAction>;
    createAsset: (input: CreateAssetInput) => Promise<Asset>;
    createAssetMemory: (input: CreateAssetMemoryInput) => Promise<AssetMemory>;
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
  sourceGeneralAction?: GeneralAction | null;
  sourceAsset?: Asset | null;
  sourceAssetMemory?: AssetMemory | null;
};
