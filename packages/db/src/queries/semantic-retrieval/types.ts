import type {
  Asset,
  AssetMemory,
  CreateAssetInput,
  CreateAssetMemoryInput,
  CreateEmbeddingJobInput,
  CreateGeneralActionInput,
  CreateRelationshipContextEmbeddingInput,
  CreateSavedItemInput,
  EmbeddingJob,
  EmbeddingJobStatus,
  GeneralAction,
  Memory,
  ParsedSearchSavedItemsSemanticInput,
  ParsedSearchSemanticContextInput,
  RelationshipContextEmbedding,
  SavedItem,
  SavedItemSemanticResult,
  SearchSavedItemsSemanticInput,
  SearchSemanticContextInput,
  SemanticRecordKind,
  SemanticRetrievalResult,
  SemanticTrustLevel,
  Sensitivity,
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

export type SearchSavedItemsSemanticRequest = SearchSavedItemsSemanticInput & {
  ownerUserId: string;
};

export type SearchSavedItemsSemanticQueryInput = ParsedSearchSavedItemsSemanticInput & {
  ownerUserId: string;
  queryEmbedding: number[];
  embeddingModel: string;
  embeddingVersion: string;
};

export type UpdateEmbeddingJobInput = {
  jobId: string;
  status?: EmbeddingJobStatus;
  lastError?: string | null;
  runAfter?: Date;
  claimedAt?: Date | null;
  completedAt?: Date | null;
};

/** What an enqueue tells an existing job: re-decide this record, from this time. */
export type ReopenEmbeddingJobInput = {
  jobId: string;
  now: Date;
  runAfter: Date;
};

export type RecoverStaleEmbeddingJobsInput = {
  now: Date;
  staleBefore: Date;
  limit: number;
};

export const STALE_EMBEDDING_JOB_RECOVERY_MESSAGE =
  "Recovered after the embedding claim lease expired.";

/** The statuses a finished pass can reach; `running` and `pending` are not verdicts. */
export type SettledEmbeddingJobStatus = Extract<
  EmbeddingJobStatus,
  "completed" | "skipped" | "failed"
>;

/**
 * The verdict a finished pass wants written, before the rerun marker is taken into account.
 * Mirrors {@link UpdateEmbeddingJobInput} minus `status`, which is narrowed to the three
 * outcomes a run can actually reach.
 */
export type SettleEmbeddingJobInput = {
  jobId: string;
  status: SettledEmbeddingJobStatus;
  now: Date;
  /** The claim generation this verdict belongs to; stale workers may not settle a replacement. */
  expectedClaimedAt: Date | null;
  lastError?: string | null;
  runAfter?: Date;
  claimedAt?: Date | null;
  completedAt?: Date | null;
};

export type SettleEmbeddingJobResult = {
  job: EmbeddingJob;
  settled: boolean;
};

export type EmbeddingJobLifecycleStore = {
  createEmbeddingJob: (job: CreateEmbeddingJobInput) => Promise<EmbeddingJob>;
  findEmbeddingJobByIdempotencyKey: (idempotencyKey: string) => Promise<EmbeddingJob | null>;
  getEmbeddingJob: (jobId: string) => Promise<EmbeddingJob | null>;
  claimEmbeddingJob: (input: { jobId: string; now: Date }) => Promise<EmbeddingJob | null>;
  claimNextEmbeddingJob: (input: { now: Date }) => Promise<EmbeddingJob | null>;
  /**
   * Reopens a bounded oldest-first batch of `running` jobs whose claim lease expired.
   * Selection and reset are one store operation so concurrent recovery passes cannot
   * recover the same row.
   */
  recoverStaleEmbeddingJobs: (input: RecoverStaleEmbeddingJobsInput) => Promise<EmbeddingJob[]>;
  updateEmbeddingJob: (input: UpdateEmbeddingJobInput) => Promise<EmbeddingJob>;
  /**
   * Applies a repeat enqueue to a job that already exists, in one statement, and returns
   * the row as it ended up.
   *
   * Three outcomes, chosen from the status the row actually has at write time rather than
   * from the one the caller read a moment earlier: a `reopenableEmbeddingJobStatuses`
   * verdict goes back to `pending` with its run mechanics reset; a `running` job takes a
   * `rerunRequestedAt` marker for its own run to consume; a `pending` or `failed` job is
   * already going to re-decide the record, so only a stale marker is cleared.
   *
   * Deciding inside the statement is the point. Read-then-write here loses exactly the edit
   * this method exists to keep: the job can be claimed, or can settle, between the two, and
   * the write then lands on a status its branch was never chosen for.
   */
  reopenEmbeddingJob: (input: ReopenEmbeddingJobInput) => Promise<EmbeddingJob>;
  /**
   * Writes a finished pass's verdict and consumes any rerun marker the row picked up while
   * that pass was in flight, in one statement, returning the row as it ended up.
   *
   * With no marker this is {@link UpdateEmbeddingJobInput} by another name. With one, a
   * `completed` or `skipped` verdict is downgraded to `pending` - it describes a state the
   * record left mid-run, so it must not be the last word - while a `failed` verdict stands,
   * because its retry backoff already schedules the extra pass the marker is asking for.
   * Either way the marker is cleared, so the next pass settles normally and no loop forms.
   *
   * Reading and clearing the marker in the settling statement is what makes the handoff
   * durable: an enqueue either marks the row before it settles, and is honored here, or
   * finds a job that is no longer `running` and reopens it outright.
   */
  settleEmbeddingJob: (input: SettleEmbeddingJobInput) => Promise<SettleEmbeddingJobResult>;
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
    getSavedItemForEmbedding: (input: {
      ownerUserId: string;
      savedItemId: string;
    }) => Promise<SavedItem | null>;
    upsertRelationshipContextEmbedding: (
      embedding: CreateRelationshipContextEmbeddingInput,
    ) => Promise<RelationshipContextEmbedding>;
    /**
     * Converges the columns a row denormalizes from its source record - person linkage,
     * trust register, sensitivity - leaving the vector, the embedded text, and the content
     * fingerprint alone. `reuseOrEmbed` calls this on a fingerprint match, the one case the
     * fingerprint provably cannot detect: the text is unchanged but the metadata beside it
     * has moved. Owner-scoped like every other store method, so a stray id cannot reach
     * another owner's row.
     */
    refreshRelationshipContextEmbeddingMetadata: (input: {
      ownerUserId: string;
      embeddingId: string;
      personId: string | null;
      trustLevel: SemanticTrustLevel;
      sensitivity: Sensitivity;
    }) => Promise<RelationshipContextEmbedding>;
    findRelationshipContextEmbedding: (input: {
      ownerUserId: string;
      recordKind: SemanticRecordKind;
      recordId: string;
      embeddingModel: string;
      embeddingVersion: string;
    }) => Promise<RelationshipContextEmbedding | null>;
    /**
     * Removes every embedding row for one record and returns how many were deleted. The
     * embed decision calls this when a record turns out to be `restricted`: the row a
     * pre-restriction run wrote still carries the full `embedded_text` and the vector
     * derived from it, and withholding that at the search seam is not the same as not
     * holding it.
     *
     * Model and version are deliberately absent from the predicate. A row written under a
     * superseded model holds the same text as the current one, so a scrub that spared it
     * would leave the text behind. Owner-scoped like every other method here.
     */
    deleteRelationshipContextEmbeddingsForRecord: (input: {
      ownerUserId: string;
      recordKind: SemanticRecordKind;
      recordId: string;
    }) => Promise<number>;
    searchSemanticContext: (
      input: SearchSemanticContextQueryInput & {
        queryEmbedding: number[];
        embeddingModel: string;
        embeddingVersion: string;
      },
    ) => Promise<SemanticRetrievalResult[]>;
    searchSavedItemsSemantic: (
      input: SearchSavedItemsSemanticQueryInput,
    ) => Promise<SavedItemSemanticResult[]>;
  };

export type InMemoryEmbeddingStore = Omit<
  InMemoryMemoryStore,
  "listSourceRecordPeople" | "listUnresolvedMentions"
> &
  EmbeddingStore & {
    createGeneralAction: (input: CreateGeneralActionInput) => Promise<GeneralAction>;
    createAsset: (input: CreateAssetInput) => Promise<Asset>;
    createAssetMemory: (input: CreateAssetMemoryInput) => Promise<AssetMemory>;
    createSavedItem: (input: CreateSavedItemInput) => Promise<SavedItem>;
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
  sourceSavedItem?: SavedItem | null;
};
