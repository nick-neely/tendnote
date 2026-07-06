import {
  claimableEmbeddingJobStatuses,
  createEmbeddingJobSchema,
  type SemanticRecordKind,
} from "@tendnote/domain";
import {
  type EmbeddingContext,
  failJob,
  processApprovedMemory,
  processGeneralAction,
  processSourceRecord,
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
  version: "v1",
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
 * Idempotently enqueues an embedding job. The idempotency key folds in the model
 * and version, so a previously completed job for the same record is reopened
 * (set back to pending) to re-embed under the current config rather than left
 * stale; a still-pending job is returned as-is.
 */
async function enqueueEmbeddingJob(
  ctx: EmbeddingContext,
  input: EnqueueEmbeddingJobInput,
): Promise<EnqueueEmbeddingJobResult> {
  const { store, config } = ctx;
  const parsed = createEmbeddingJobSchema.parse({
    ownerUserId: input.ownerUserId,
    recordKind: input.recordKind,
    recordId: input.recordId,
    status: "pending",
    attempts: 0,
    lastError: null,
    idempotencyKey: idempotencyKeyFor({ ...input, config }),
    runAfter: input.runAfter ?? new Date(),
  });
  const existing = await store.findEmbeddingJobByIdempotencyKey(parsed.idempotencyKey);

  if (existing) {
    if (existing.status === "completed") {
      const job = await store.updateEmbeddingJob({
        jobId: existing.id,
        status: "pending",
        lastError: null,
        runAfter: input.runAfter ?? new Date(),
        claimedAt: null,
        completedAt: null,
      });

      return { job, created: false };
    }

    return { job: existing, created: false };
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
 */
async function processEmbeddingJob(
  ctx: EmbeddingContext,
  input: ProcessEmbeddingJobInput,
): Promise<ProcessEmbeddingJobResult> {
  const { store } = ctx;
  const now = input.now ?? new Date();
  const retryDelayMs = input.retryDelayMs ?? DEFAULT_EMBEDDING_RETRY_DELAY_MS;
  const claim = input.claim ?? true;
  const existingJob = await store.getEmbeddingJob(input.jobId);

  if (!existingJob) {
    throw new Error("Embedding job not found.");
  }

  let job = existingJob;

  if (job.status !== "running") {
    if (!claim || !isClaimableStatus(job.status)) {
      return { job, outcome: "not_claimable", embedding: null };
    }

    const claimed = await store.claimEmbeddingJob({ jobId: job.id, now });

    if (!claimed) {
      return { job, outcome: "not_claimable", embedding: null };
    }

    job = claimed;
  }

  try {
    const result = await processJobByKind(ctx, job);

    if ("skipReason" in result) {
      return skipJob(ctx, job, result.skipReason, now, {
        sourceMemory: "sourceMemory" in result ? result.sourceMemory : null,
        sourceRecord: "sourceRecord" in result ? result.sourceRecord : null,
        sourceGeneralAction: "sourceGeneralAction" in result ? result.sourceGeneralAction : null,
      });
    }

    if (!result.embedding) {
      return failJob(ctx, job, "Embedding was not created.", now, retryDelayMs);
    }

    const updated = await store.updateEmbeddingJob({
      jobId: job.id,
      status: "completed",
      completedAt: now,
      lastError: null,
    });

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
      job: updated,
      outcome: "completed",
      embedding: result.embedding,
      sourceMemory: result.sourceMemory,
      sourceRecord: result.sourceRecord,
      sourceGeneralAction: result.sourceGeneralAction,
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
    getEmbeddingJob: (jobId: string) => store.getEmbeddingJob(jobId),
    processEmbeddingJob: (input: ProcessEmbeddingJobInput) => processEmbeddingJob(ctx, input),
  };
}
