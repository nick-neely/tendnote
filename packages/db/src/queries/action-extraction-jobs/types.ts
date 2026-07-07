import type {
  CreateExtractionJobInput,
  ExtractionJob,
  ExtractionJobStatus,
  GeneralAction,
  GeneralActionArea,
  SourceRecord,
  SourceRecordPerson,
  SuggestedActionExtractionAdapter,
} from "@tendnote/domain";
import type {
  GeneralActionEmbeddingScheduler,
  GeneralActionLifecycleStore,
  InMemoryGeneralActionLifecycleStore,
} from "../general-actions/types";

export type UpdateActionExtractionJobInput = {
  jobId: string;
  status?: ExtractionJobStatus;
  lastError?: string | null;
  runAfter?: Date;
  claimedAt?: Date | null;
  completedAt?: Date | null;
};

/**
 * Postgres-owned action extraction job lifecycle: inspectable rows that can be created,
 * claimed, retried, and updated. Mirrors the suggested-memory extraction job lifecycle
 * (ADR 0018) but over the separate `action_extraction_jobs` table, so a queue can carry
 * job ids without owning job state and the two extraction pipelines never contend for
 * the same rows.
 */
export type ActionExtractionJobLifecycleStore = {
  createActionExtractionJob: (job: CreateExtractionJobInput) => Promise<ExtractionJob>;
  findActionExtractionJobByIdempotencyKey: (
    idempotencyKey: string,
  ) => Promise<ExtractionJob | null>;
  getActionExtractionJob: (jobId: string) => Promise<ExtractionJob | null>;
  claimActionExtractionJob: (input: { jobId: string; now: Date }) => Promise<ExtractionJob | null>;
  claimNextActionExtractionJob: (input: { now: Date }) => Promise<ExtractionJob | null>;
  updateActionExtractionJob: (input: UpdateActionExtractionJobInput) => Promise<ExtractionJob>;
};

/**
 * Everything the action extraction processor needs from its environment. It composes the
 * General Action lifecycle store — so it can propose Suggested General Actions through
 * the shared review seam (grounding, Area, scope, people links, history) — with the
 * action-job lifecycle and the few system-level reads the async processor performs
 * outside a single owner request: loading a source record by id, its people links, its
 * owner's Areas (for filing), and the actions already grounded in it (for dedupe).
 */
export type ActionExtractionJobStore = GeneralActionLifecycleStore &
  ActionExtractionJobLifecycleStore & {
    getSourceRecordById: (sourceRecordId: string) => Promise<SourceRecord | null>;
    listSourceRecordPeople: (input: { sourceRecordId: string }) => Promise<SourceRecordPerson[]>;
    listAreasForOwner: (input: {
      ownerUserId: string;
      includeArchived?: boolean;
    }) => Promise<GeneralActionArea[]>;
    /** Owner-scoped: every General Action (any status) grounded in this source record. */
    listGeneralActionsForSourceRecord: (input: {
      ownerUserId: string;
      sourceRecordId: string;
    }) => Promise<GeneralAction[]>;
  };

/**
 * In-memory action extraction store for tests: the full in-memory General Action
 * lifecycle store (so tests can seed people, source records, Areas, and households
 * directly) plus the action-job lifecycle and the source-record-scoped read. Assignable
 * to `ActionExtractionJobStore`, so the processor accepts it unchanged.
 */
export type InMemoryActionExtractionJobStore = InMemoryGeneralActionLifecycleStore &
  ActionExtractionJobLifecycleStore & {
    listGeneralActionsForSourceRecord: (input: {
      ownerUserId: string;
      sourceRecordId: string;
    }) => Promise<GeneralAction[]>;
  };

export type EnqueueActionExtractionJobInput = {
  sourceRecordId: string;
  runAfter?: Date;
};

export type EnqueueActionExtractionJobResult = {
  job: ExtractionJob;
  created: boolean;
};

export type ProcessActionExtractionJobInput = {
  jobId: string;
  now?: Date;
  claim?: boolean;
  directlyRequested?: boolean;
  retryDelayMs?: number;
};

export type ProcessActionExtractionJobOutcome =
  | "not_claimable"
  | "skipped"
  | "completed"
  | "failed";

export type ProcessActionExtractionJobResult = {
  job: ExtractionJob;
  outcome: ProcessActionExtractionJobOutcome;
  /** The `general_actions` ids proposed on this run (empty on skip/fail/no-op). */
  suggestedActionIds: string[];
  reason?: string;
  error?: string;
};

export type CreateActionExtractionProcessorOptions = {
  extractionAdapter?: SuggestedActionExtractionAdapter;
  /**
   * Embed-on-write for extraction-sourced suggestions: threaded into the review seam so
   * a Suggested General Action produced by extraction is embedded on write, exactly like
   * one created through the general-actions barrel. Defaults to a no-op, so unit harnesses
   * that do not exercise retrieval stay deterministic (ADR 0150; Phase 5 #183/#184).
   */
  scheduleGeneralActionEmbedding?: GeneralActionEmbeddingScheduler;
};
