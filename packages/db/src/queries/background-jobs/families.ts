import type { EmbeddingJobStatus, ExtractionJobStatus, SemanticRecordKind } from "@tendnote/domain";
import {
  claimActionExtractionJob,
  claimNextActionExtractionJob,
  type EnqueueAndTriggerActionExtractionJobResult,
  enqueueAndTriggerActionExtractionJob,
  getActionExtractionJob,
  type ProcessActionExtractionJobOutcome,
  processActionExtractionJob,
} from "../action-extraction-jobs";
import type { BackgroundJobKind } from "../background-job-deliveries/topics";

export type BackgroundProcessorJobKind = Exclude<BackgroundJobKind, "reminder_push">;

import {
  claimExtractionJob,
  claimNextExtractionJob,
  type EnqueueAndTriggerExtractionJobResult,
  enqueueAndTriggerExtractionJob,
  getExtractionJob,
  type ProcessExtractionJobOutcome,
  processExtractionJob,
  resolveExtractionRuntimeMode,
} from "../extraction-jobs";
import {
  claimNextSemanticEmbeddingJob,
  claimSemanticEmbeddingJob,
  type EnqueueAndTriggerSemanticEmbeddingJobResult,
  enqueueAndTriggerSemanticEmbeddingJob,
  getSemanticEmbeddingJob,
  type ProcessEmbeddingJobOutcome,
  processSemanticEmbeddingJob,
  resolveSemanticEmbeddingRuntimeMode,
} from "../semantic-retrieval";

/**
 * How a Postgres-owned job runs once enqueued: `enqueue_only` leaves the durable job for
 * a queue/cron worker, `inline` triggers it immediately (the default outside production so
 * local capture yields reviewable results). Shared by every job family so mode resolution
 * is defined once.
 */
export type BackgroundJobRuntimeMode = "enqueue_only" | "inline";

/**
 * The lifecycle status a Postgres-owned job row reports to the shared runtime — the union
 * of every family's own status enum. Kept a literal union (not `string`) so the runtime's
 * terminal-state branch (`completed` / `skipped`) stays type-checked across families.
 */
export type BackgroundJobStatus = ExtractionJobStatus | EmbeddingJobStatus;

/**
 * The outcome a processor run reports to the shared runtime — the union of every family's
 * own outcome enum. The runtime only rethrows on `failed`, but keeping the literal union
 * means a typo in that comparison fails to compile.
 */
export type BackgroundJobProcessOutcome =
  | ProcessExtractionJobOutcome
  | ProcessActionExtractionJobOutcome
  | ProcessEmbeddingJobOutcome;

/**
 * The consume/recovery mechanics every job family exposes, independent of what the family
 * enqueues. Claim translation, terminal-state inspection, processing, and queue-less
 * backfill are all driven through these — {@link BackgroundJobFamily} adds the
 * enqueue-side binding on top.
 */
export type BackgroundJobFamilyMechanics = {
  jobKind: BackgroundProcessorJobKind;
  /** Human-readable noun for claim/anomaly messages, e.g. "Extraction job". */
  noun: string;
  /** Idempotently claim the owner-scoped job for one delivered message. */
  claimJob: (input: {
    jobId: string;
    now?: Date;
  }) => Promise<{ status: BackgroundJobStatus } | null>;
  /** Reload the job to interpret a claim miss (missing / terminal / not-yet-claimable). */
  getJob: (jobId: string) => Promise<{ status: BackgroundJobStatus } | null>;
  /** Process an already-claimed job; the runtime rethrows a `failed` outcome. */
  processJob: (input: {
    jobId: string;
    claim: false;
  }) => Promise<{ outcome: BackgroundJobProcessOutcome; error?: string; reason?: string }>;
  /** Claim the next due job (FIFO) for queue-less recovery backfill. */
  claimNextJob: (input: { now?: Date }) => Promise<{ id: string } | null>;
};

/**
 * The shared execution binding for one Postgres-owned job family (Suggested Memory
 * extraction, General Action extraction, semantic embedding). It adds runtime-mode
 * resolution and enqueue-and-trigger to the shared {@link BackgroundJobFamilyMechanics},
 * while each family keeps its own domain processor behind these functions.
 *
 * This registry is a *closed* enumeration of known families, not a generic event bus:
 * {@link BACKGROUND_JOB_FAMILIES} is exhaustively checked against
 * {@link BackgroundProcessorJobKind}, so adding another processor family is an explicit,
 * type-enforced
 * registration rather than a dynamic subscription.
 */
export type BackgroundJobFamily<
  TEnqueueInput,
  TEnqueueResult extends { job: { id: string } },
> = BackgroundJobFamilyMechanics & {
  /**
   * Resolve the effective runtime mode: an explicit mode wins, otherwise this family's
   * env var and `NODE_ENV` decide (matching each family's historical default).
   */
  resolveRuntimeMode: (mode?: BackgroundJobRuntimeMode) => BackgroundJobRuntimeMode;
  /** Enqueue the durable job and, inline, trigger it (the family's default processor). */
  enqueueAndTrigger: (
    input: TEnqueueInput & { runtimeMode: BackgroundJobRuntimeMode },
  ) => Promise<TEnqueueResult>;
};

/**
 * Extraction and General Action extraction share one runtime env
 * (`TENDNOTE_EXTRACTION_RUNTIME`): a burst of either should run under the same inline /
 * enqueue-only decision, so the resolution is defined once here.
 */
function resolveExtractionModeFromEnv(mode?: BackgroundJobRuntimeMode): BackgroundJobRuntimeMode {
  return (
    mode ??
    resolveExtractionRuntimeMode({
      configured: process.env.TENDNOTE_EXTRACTION_RUNTIME,
      nodeEnv: process.env.NODE_ENV,
    })
  );
}

export const extractionJobFamily: BackgroundJobFamily<
  { sourceRecordId: string },
  EnqueueAndTriggerExtractionJobResult
> = {
  jobKind: "extraction",
  noun: "Extraction job",
  resolveRuntimeMode: resolveExtractionModeFromEnv,
  enqueueAndTrigger: enqueueAndTriggerExtractionJob,
  claimJob: claimExtractionJob,
  getJob: getExtractionJob,
  processJob: processExtractionJob,
  claimNextJob: claimNextExtractionJob,
};

export const actionExtractionJobFamily: BackgroundJobFamily<
  { sourceRecordId: string },
  EnqueueAndTriggerActionExtractionJobResult
> = {
  jobKind: "action_extraction",
  noun: "Action extraction job",
  resolveRuntimeMode: resolveExtractionModeFromEnv,
  enqueueAndTrigger: enqueueAndTriggerActionExtractionJob,
  claimJob: claimActionExtractionJob,
  getJob: getActionExtractionJob,
  processJob: processActionExtractionJob,
  claimNextJob: claimNextActionExtractionJob,
};

export const embeddingJobFamily: BackgroundJobFamily<
  { ownerUserId: string; recordKind: SemanticRecordKind; recordId: string },
  EnqueueAndTriggerSemanticEmbeddingJobResult
> = {
  jobKind: "embedding",
  noun: "Embedding job",
  resolveRuntimeMode: (mode) =>
    mode ??
    resolveSemanticEmbeddingRuntimeMode({
      configured: process.env.TENDNOTE_EMBEDDING_RUNTIME,
      nodeEnv: process.env.NODE_ENV,
    }),
  enqueueAndTrigger: enqueueAndTriggerSemanticEmbeddingJob,
  claimJob: claimSemanticEmbeddingJob,
  getJob: getSemanticEmbeddingJob,
  processJob: processSemanticEmbeddingJob,
  claimNextJob: claimNextSemanticEmbeddingJob,
};

/**
 * The closed registry of Postgres-owned job families, keyed by job kind. Every
 * {@link BackgroundProcessorJobKind} must appear here — the `_exhaustive` guard below fails to
 * compile if a new topic is added without a matching family, so registering a new job
 * family stays explicit (deletion/completeness test in `families.test.ts`).
 */
export const BACKGROUND_JOB_FAMILIES = {
  extraction: extractionJobFamily,
  action_extraction: actionExtractionJobFamily,
  embedding: embeddingJobFamily,
} as const;

// Compile-time completeness: every job kind is registered. Adding a BackgroundJobKind
// without a family here turns this into a type error rather than a silent runtime gap.
type RegisteredJobKind = keyof typeof BACKGROUND_JOB_FAMILIES;
const _exhaustive: RegisteredJobKind extends BackgroundProcessorJobKind
  ? BackgroundProcessorJobKind extends RegisteredJobKind
    ? true
    : never
  : never = true;
void _exhaustive;
