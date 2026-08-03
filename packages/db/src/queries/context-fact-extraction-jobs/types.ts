import type {
  ContextFactExtractionAdapter,
  ContextFactExtractionJob,
  ContextFactExtractionJobStatus,
  CreateContextFactExtractionJobInput,
} from "@tendnote/domain";
import type { AffectedScope } from "../affected-scopes";
import type { ContextFactStore } from "../context-facts/types";

export type UpdateContextFactExtractionJobInput = {
  jobId: string;
  status?: ContextFactExtractionJobStatus;
  message?: string | null;
  claimToken?: string | null;
  expectedClaimToken?: string;
  lastError?: string | null;
  runAfter?: Date;
  claimedAt?: Date | null;
  completedAt?: Date | null;
};

export type ContextFactExtractionJobLifecycleStore = {
  createContextFactExtractionJob: (
    input: CreateContextFactExtractionJobInput,
  ) => Promise<ContextFactExtractionJob>;
  findContextFactExtractionJobByIdempotencyKey: (
    idempotencyKey: string,
  ) => Promise<ContextFactExtractionJob | null>;
  getContextFactExtractionJob: (jobId: string) => Promise<ContextFactExtractionJob | null>;
  claimContextFactExtractionJob: (input: {
    jobId: string;
    now: Date;
  }) => Promise<ContextFactExtractionJob | null>;
  claimNextContextFactExtractionJob: (input: {
    now: Date;
  }) => Promise<ContextFactExtractionJob | null>;
  updateContextFactExtractionJob: (
    input: UpdateContextFactExtractionJobInput,
  ) => Promise<ContextFactExtractionJob | null>;
  countPendingContextFactExtractionJobs: (input: { ownerUserId: string }) => Promise<number>;
};

/** One shared owner-scoped Context Fact store plus this family's isolated job lifecycle. */
export type ContextFactExtractionJobStore = ContextFactStore &
  ContextFactExtractionJobLifecycleStore;

export type InMemoryContextFactExtractionJobStore = ContextFactExtractionJobStore & {
  listContextFactExtractionJobs: () => Promise<ContextFactExtractionJob[]>;
};

export type EnqueueContextFactExtractionJobInput = {
  ownerUserId: string;
  message: string;
  idempotencyKey: string;
  runAfter?: Date;
};

export type EnqueueContextFactExtractionJobResult = {
  job: ContextFactExtractionJob;
  created: boolean;
};

export type ProcessContextFactExtractionJobInput = {
  jobId: string;
  now?: Date;
  claim?: boolean;
  claimToken?: string;
  retryDelayMs?: number;
  maxAttempts?: number;
};

export type ProcessContextFactExtractionJobOutcome =
  | "not_found"
  | "not_claimable"
  | "completed"
  | "failed"
  | "dead_lettered";

export type ProcessContextFactExtractionJobResult = {
  job: ContextFactExtractionJob;
  outcome: ProcessContextFactExtractionJobOutcome;
  createdSuggestionCount: number;
  existingSuggestionCount: number;
  invalidCandidateCount: number;
  suppressedCandidateCount: number;
  affectedScopes: AffectedScope[];
  error?: string;
};

export type CreateContextFactExtractionProcessorOptions = {
  extractionAdapter?: ContextFactExtractionAdapter;
  maxAttempts?: number;
};
