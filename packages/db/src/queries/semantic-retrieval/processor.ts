import {
  claimableEmbeddingJobStatuses,
  createEmbeddingJobSchema,
  type SemanticRecordKind,
} from "@tendnote/domain";
import {
  type EmbeddingContext,
  failJob,
  processApprovedMemory,
  processAsset,
  processAssetMemory,
  processGeneralAction,
  processSavedItem,
  processSourceRecord,
  scrubRestrictedEmbeddings,
  skipJob,
} from "./steps";
import type {
  EmbeddingAdapter,
  EmbeddingConfig,
  EmbeddingStore,
  EnqueueEmbeddingJobInput,
  EnqueueEmbeddingJobResult,
  ProcessEmbeddingJobInput,
  ProcessEmbeddingJobResult,
} from "./types";

export { fingerprintEmbeddedText } from "./steps";

export const DEFAULT_EMBEDDING_RETRY_DELAY_MS = 5 * 60 * 1000;
export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  model: "fake-semantic-retrieval",
  version: "v2",
};

const CLAIMABLE_STATUSES = new Set(claimableEmbeddingJobStatuses);

function isClaimableStatus(status: ProcessEmbeddingJobResult["job"]["status"]) {
  return CLAIMABLE_STATUSES.has(status as (typeof claimableEmbeddingJobStatuses)[number]);
}

function idempotencyKeyFor(input: {
  ownerUserId: string;
  recordKind: SemanticRecordKind;
  recordId: string;
  config: EmbeddingConfig;
}) {
  return [
    "relationship_context_embedding",
    input.ownerUserId,
    input.recordKind,
    input.recordId,
    input.config.model,
    input.config.version,
  ].join(":");
}

/**
 * Idempotently enqueues an embedding job. The idempotency key folds in the model and
 * version, so a second enqueue for the same record never creates a second job: the store
 * reconciles the one that exists against the news this call is carrying - the record
 * changed - and hands it back.
 *
 * How it reconciles is the store's business precisely because the answer depends on the
 * status the job holds at write time, not the one read here (`reopenEmbeddingJob`). Most of
 * that is a straight reopen to `pending`; the case worth naming is a job that is already
 * `running`, whose in-flight pass read the record before this edit and so cannot be allowed
 * to have the last word. It takes a rerun marker its own settle turns into another pass
 * (#330).
 */
async function enqueueEmbeddingJob(
  ctx: EmbeddingContext,
  input: EnqueueEmbeddingJobInput,
): Promise<EnqueueEmbeddingJobResult> {
  const { store, config } = ctx;
  const now = new Date();
  const parsed = createEmbeddingJobSchema.parse({
    ownerUserId: input.ownerUserId,
    recordKind: input.recordKind,
    recordId: input.recordId,
    status: "pending",
    attempts: 0,
    lastError: null,
    idempotencyKey: idempotencyKeyFor({ ...input, config }),
    runAfter: input.runAfter ?? now,
  });
  const existing = await store.findEmbeddingJobByIdempotencyKey(parsed.idempotencyKey);

  if (existing) {
    const job = await store.reopenEmbeddingJob({
      jobId: existing.id,
      now,
      runAfter: input.runAfter ?? now,
    });

    return { job, created: false };
  }

  const job = await store.createEmbeddingJob(parsed);

  await store.createAuditLogEntry({
    ownerUserId: job.ownerUserId,
    action: "embedding_job.enqueue",
    entityType: "relationship_context_embedding_job",
    entityId: job.id,
    metadataJson: { recordKind: job.recordKind, recordId: job.recordId },
  });

  return { job, created: true };
}

/**
 * Claims an embedding job (unless asked not to), embeds its record by kind, and
 * records the outcome: skip, fail, or complete. A job already `running` is
 * processed without re-claiming; anything not claimable returns early untouched.
 *
 * `outcome` describes the pass that just ran; `job.status` describes what the queue holds
 * afterwards. They part company by design when an edit lands mid-run: the pass really did
 * complete or skip, and the job is `pending` again to re-decide the record it did that
 * against.
 */
/** Applies the per-call defaults (clock, retry delay, claim opt-out) once. */
function resolveProcessOptions(input: ProcessEmbeddingJobInput) {
  return {
    now: input.now ?? new Date(),
    retryDelayMs: input.retryDelayMs ?? DEFAULT_EMBEDDING_RETRY_DELAY_MS,
    claim: input.claim ?? true,
  };
}

/**
 * Resolves the job to process: a `running` job is returned as-is (processed without
 * re-claiming), an unclaimed-but-claimable job is atomically claimed, and anything not
 * claimable (opt-out, wrong status, or a lost claim race) returns null so the caller
 * exits untouched.
 */
async function claimJobForProcessing(
  store: EmbeddingStore,
  job: ProcessEmbeddingJobResult["job"],
  claim: boolean,
  now: Date,
): Promise<ProcessEmbeddingJobResult["job"] | null> {
  if (job.status === "running") return job;
  if (!claim || !isClaimableStatus(job.status)) return null;
  const claimed = await store.claimEmbeddingJob({ jobId: job.id, now });
  return claimed ?? null;
}

/** The optional source records a skip decision may carry, defaulted to null. */
function extractSkipSources(result: Awaited<ReturnType<typeof processJobByKind>>) {
  return {
    sourceMemory: "sourceMemory" in result ? result.sourceMemory : null,
    sourceRecord: "sourceRecord" in result ? result.sourceRecord : null,
    sourceGeneralAction: "sourceGeneralAction" in result ? result.sourceGeneralAction : null,
    sourceAsset: "sourceAsset" in result ? result.sourceAsset : null,
    sourceAssetMemory: "sourceAssetMemory" in result ? result.sourceAssetMemory : null,
    sourceSavedItem: "sourceSavedItem" in result ? result.sourceSavedItem : null,
  };
}

async function processEmbeddingJob(
  ctx: EmbeddingContext,
  input: ProcessEmbeddingJobInput,
): Promise<ProcessEmbeddingJobResult> {
  const { store } = ctx;
  const { now, retryDelayMs, claim } = resolveProcessOptions(input);
  const existingJob = await store.getEmbeddingJob(input.jobId);

  if (!existingJob) {
    throw new Error("Embedding job not found.");
  }

  const job = await claimJobForProcessing(store, existingJob, claim, now);
  if (!job) {
    return { job: existingJob, outcome: "not_claimable", embedding: null };
  }

  try {
    const result = await processJobByKind(ctx, job);

    if ("skipReason" in result) {
      await scrubRestrictedEmbeddings(ctx, job, result.skipReason);

      return skipJob(ctx, job, result.skipReason, now, extractSkipSources(result));
    }

    if (!result.embedding) {
      return failJob(ctx, job, "Embedding was not created.", now, retryDelayMs);
    }

    const settlement = await store.settleEmbeddingJob({
      jobId: job.id,
      status: "completed",
      now,
      expectedClaimedAt: job.claimedAt ?? null,
      completedAt: now,
      lastError: null,
    });

    if (!settlement.settled) {
      return { job: settlement.job, outcome: "not_claimable", embedding: null };
    }

    await store.createAuditLogEntry({
      ownerUserId: job.ownerUserId,
      action: "embedding_job.completed",
      entityType: "relationship_context_embedding_job",
      entityId: job.id,
      metadataJson: {
        recordKind: job.recordKind,
        recordId: job.recordId,
        embeddingId: result.embedding.id,
      },
    });

    return {
      job: settlement.job,
      outcome: "completed",
      embedding: result.embedding,
      sourceMemory: result.sourceMemory,
      sourceRecord: result.sourceRecord,
      sourceGeneralAction: result.sourceGeneralAction,
      sourceAsset: result.sourceAsset,
      sourceAssetMemory: result.sourceAssetMemory,
      sourceSavedItem: result.sourceSavedItem,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failJob(ctx, job, message, now, retryDelayMs);
  }
}

/** Dispatches a job to the embedding step for its record kind. */
function processJobByKind(ctx: EmbeddingContext, job: ProcessEmbeddingJobResult["job"]) {
  switch (job.recordKind) {
    case "memory":
      return processApprovedMemory(ctx, job);
    case "source_record":
      return processSourceRecord(ctx, job);
    case "general_action":
      return processGeneralAction(ctx, job);
    case "asset":
      return processAsset(ctx, job);
    case "asset_memory":
      return processAssetMemory(ctx, job);
    case "saved_item":
      return processSavedItem(ctx, job);
  }
}

export function createEmbeddingProcessor(
  store: EmbeddingStore,
  adapter: EmbeddingAdapter,
  config: EmbeddingConfig = DEFAULT_EMBEDDING_CONFIG,
) {
  const ctx: EmbeddingContext = { store, adapter, config };

  return {
    enqueueEmbeddingJob: (input: EnqueueEmbeddingJobInput) => enqueueEmbeddingJob(ctx, input),
    claimNextEmbeddingJob: (input: { now?: Date } = {}) =>
      store.claimNextEmbeddingJob({ now: input.now ?? new Date() }),
    claimEmbeddingJob: (input: { jobId: string; now?: Date }) =>
      store.claimEmbeddingJob({ jobId: input.jobId, now: input.now ?? new Date() }),
    async recoverStaleEmbeddingJobs(input: {
      leaseDurationMs: number;
      now?: Date;
      limit?: number;
    }) {
      const now = input.now ?? new Date();
      const leaseDurationMs = input.leaseDurationMs;
      const jobs = await store.recoverStaleEmbeddingJobs({
        now,
        staleBefore: new Date(now.getTime() - leaseDurationMs),
        limit: input.limit ?? 5,
      });

      await Promise.all(
        jobs.map((job) =>
          store.createAuditLogEntry({
            ownerUserId: job.ownerUserId,
            action: "embedding_job.recovered",
            entityType: "relationship_context_embedding_job",
            entityId: job.id,
            metadataJson: {
              recordKind: job.recordKind,
              recordId: job.recordId,
              leaseDurationMs,
              recoveredAt: now.toISOString(),
            },
          }),
        ),
      );

      return { jobs };
    },
    getEmbeddingJob: (jobId: string) => store.getEmbeddingJob(jobId),
    processEmbeddingJob: (input: ProcessEmbeddingJobInput) => processEmbeddingJob(ctx, input),
  };
}
