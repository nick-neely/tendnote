import type {
  CreateExtractionJobInput,
  ExtractionJob,
  ExtractionJobStatus,
  Memory,
  SourceRecord,
  SourceRecordPerson,
  UnresolvedPersonMention,
} from "@tendnote/domain";
import type { InMemoryMemoryStore, MemoryCaptureStore } from "../memories/types";

export type UpdateExtractionJobInput = {
  jobId: string;
  status?: ExtractionJobStatus;
  lastError?: string | null;
  runAfter?: Date;
  claimedAt?: Date | null;
  completedAt?: Date | null;
};

/**
 * Postgres-owned extraction job lifecycle: jobs are inspectable rows that can be
 * created, claimed, retried, and updated. A queue (Vercel Queues, cron) can
 * trigger processing later, but it carries job ids and never owns job state.
 */
export type ExtractionJobLifecycleStore = {
  createExtractionJob: (job: CreateExtractionJobInput) => Promise<ExtractionJob>;
  findExtractionJobByIdempotencyKey: (idempotencyKey: string) => Promise<ExtractionJob | null>;
  getExtractionJob: (jobId: string) => Promise<ExtractionJob | null>;
  // Claims a single job by id if it is in a claimable state (pending or failed)
  // and due (runAfter <= now), atomically flipping it to running and bumping the
  // attempt count. Returns null when the job is not claimable.
  claimExtractionJob: (input: { jobId: string; now: Date }) => Promise<ExtractionJob | null>;
  // Claims the next due job (FIFO by runAfter) for queue-less polling. Returns
  // null when nothing is claimable.
  claimNextExtractionJob: (input: { now: Date }) => Promise<ExtractionJob | null>;
  updateExtractionJob: (input: UpdateExtractionJobInput) => Promise<ExtractionJob>;
};

/**
 * Shared owner-scoped store contract for the extraction processor. It extends
 * the memory capture store (suggested memories must keep source-record
 * provenance) with the system-level reads the async processor needs and the
 * Postgres-owned job lifecycle. Extraction runs outside a single owner request,
 * so it loads source records by id and derives owner scope from the loaded
 * record rather than trusting a caller-supplied owner id.
 */
export type ExtractionJobStore = MemoryCaptureStore &
  ExtractionJobLifecycleStore & {
    getSourceRecordById: (sourceRecordId: string) => Promise<SourceRecord | null>;
    listSourceRecordPeople: (input: { sourceRecordId: string }) => Promise<SourceRecordPerson[]>;
    listUnresolvedMentions: (input: {
      sourceRecordId: string;
    }) => Promise<UnresolvedPersonMention[]>;
  };

export type InMemoryExtractionJobStore = InMemoryMemoryStore &
  ExtractionJobLifecycleStore & {
    listExtractionJobs: () => Promise<ExtractionJob[]>;
  };

export type EnqueueExtractionJobInput = {
  sourceRecordId: string;
  runAfter?: Date;
};

export type EnqueueExtractionJobResult = {
  job: ExtractionJob;
  created: boolean;
};

export type ProcessExtractionJobInput = {
  jobId: string;
  now?: Date;
  claim?: boolean;
  directlyRequested?: boolean;
  retryDelayMs?: number;
};

export type ProcessExtractionJobOutcome =
  | "not_found"
  | "not_claimable"
  | "skipped"
  | "delayed"
  | "partial"
  | "completed"
  | "failed";

export type ProcessExtractionJobResult = {
  job: ExtractionJob;
  outcome: ProcessExtractionJobOutcome;
  suggestedMemories: Memory[];
  reason?: string;
  error?: string;
};
