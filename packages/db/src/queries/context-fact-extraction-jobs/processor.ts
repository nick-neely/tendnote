import {
  type ContextFactExtractionAdapter,
  type ContextFactExtractionJob,
  ContextFactValidationError,
  createDeterministicContextFactExtractionAdapter,
  MAX_PENDING_CONTEXT_FACT_SUGGESTIONS_PER_OWNER,
  validateContextFactExtractionCandidates,
} from "@tendnote/domain";
import { createContextFactQueries } from "../context-facts/queries";
import type {
  ContextFactExtractionJobStore,
  CreateContextFactExtractionProcessorOptions,
  EnqueueContextFactExtractionJobInput,
  EnqueueContextFactExtractionJobResult,
  ProcessContextFactExtractionJobInput,
  ProcessContextFactExtractionJobResult,
} from "./types";

export const DEFAULT_CONTEXT_FACT_EXTRACTION_RETRY_DELAY_MS = 5 * 60 * 1000;
export const DEFAULT_CONTEXT_FACT_EXTRACTION_MAX_ATTEMPTS = 3;

type ProcessorContext = {
  store: ContextFactExtractionJobStore;
  extractionAdapter: ContextFactExtractionAdapter;
  maxAttempts: number;
};

function scrubFailureMessage(message: string) {
  return message.replace(/\s+/g, " ").trim().slice(0, 200);
}

function adapterProvenance(adapter: ContextFactExtractionAdapter) {
  return {
    adapterKind: adapter.kind,
    ...(adapter.model ? { extractionModel: adapter.model } : {}),
    ...(adapter.promptVersion ? { promptVersion: adapter.promptVersion } : {}),
  };
}

function ambientProvenance() {
  return { channel: "ambient" as const, origin: "ambient" as const, sourceRecordId: null };
}

function emptyResult(
  job: ContextFactExtractionJob,
  outcome: ProcessContextFactExtractionJobResult["outcome"],
): ProcessContextFactExtractionJobResult {
  return {
    job,
    outcome,
    createdSuggestionCount: 0,
    existingSuggestionCount: 0,
    invalidCandidateCount: 0,
    suppressedCandidateCount: 0,
  };
}

async function failJob(
  ctx: ProcessorContext,
  job: ContextFactExtractionJob,
  error: unknown,
  now: Date,
  retryDelayMs: number,
  maxAttempts: number,
): Promise<ProcessContextFactExtractionJobResult> {
  const message = error instanceof Error ? error.message : String(error);
  const deadLettered = job.attempts >= maxAttempts;
  const updated = await ctx.store.updateContextFactExtractionJob({
    jobId: job.id,
    status: deadLettered ? "dead_lettered" : "failed",
    lastError: scrubFailureMessage(message),
    ...(deadLettered
      ? { completedAt: now, claimedAt: null }
      : { runAfter: new Date(now.getTime() + retryDelayMs), claimedAt: null }),
  });

  await ctx.store.createAuditLogEntry({
    ownerUserId: job.ownerUserId,
    action: deadLettered
      ? "context_fact_extraction_job.dead_lettered"
      : "context_fact_extraction_job.failed",
    entityType: "context_fact_extraction_job",
    entityId: job.id,
    metadataJson: {
      messageLength: job.message.length,
      attempts: job.attempts,
      failureReason: "processor_error",
      failureMessage: scrubFailureMessage(message),
      ...adapterProvenance(ctx.extractionAdapter),
    },
  });

  return {
    ...emptyResult(updated, deadLettered ? "dead_lettered" : "failed"),
    error: message,
  };
}

async function processContextFactExtractionJob(
  ctx: ProcessorContext,
  input: ProcessContextFactExtractionJobInput,
): Promise<ProcessContextFactExtractionJobResult> {
  const now = input.now ?? new Date();
  const existingJob = await ctx.store.getContextFactExtractionJob(input.jobId);
  if (!existingJob) throw new Error("Context Fact extraction job not found.");

  let job = existingJob;
  if (job.status !== "running") {
    if (input.claim === false) return emptyResult(job, "not_claimable");
    const claimed = await ctx.store.claimContextFactExtractionJob({ jobId: job.id, now });
    if (!claimed) return emptyResult(job, "not_claimable");
    job = claimed;
  }

  let validated: ReturnType<typeof validateContextFactExtractionCandidates>;
  let createdSuggestionCount = 0;
  let existingSuggestionCount = 0;
  let suppressedCandidateCount = 0;

  try {
    // The adapter receives only this job's bounded message. No owner history or other
    // domain records are loaded here, so the current-message boundary is structural.
    const adapterResult = await ctx.extractionAdapter.extractCandidates({ message: job.message });
    validated = validateContextFactExtractionCandidates(adapterResult, {
      message: job.message,
    });
    const contextFactQueries = createContextFactQueries(ctx.store, {
      maxPendingSuggestedContextFacts: MAX_PENDING_CONTEXT_FACT_SUGGESTIONS_PER_OWNER,
      resolveVerifiedCaller: async () => job.ownerUserId,
    });

    for (const candidate of validated.validCandidates) {
      try {
        const result = await contextFactQueries.createSuggestedSelfContextFact({
          callerUserId: job.ownerUserId,
          category: candidate.category,
          content: candidate.content,
          sensitivity: candidate.sensitivity,
          provenance: ambientProvenance(),
          suggestionEvidence: candidate.evidence,
        });
        if (result.decision === "created") {
          createdSuggestionCount += 1;
        } else {
          existingSuggestionCount += 1;
        }
      } catch (error) {
        // Dismissal suppression and the pending-owner cap are deterministic review policy, not
        // queue failures. Other persistence errors must retry the whole job.
        if (error instanceof ContextFactValidationError) {
          suppressedCandidateCount += 1;
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    return failJob(
      ctx,
      job,
      error,
      now,
      input.retryDelayMs ?? DEFAULT_CONTEXT_FACT_EXTRACTION_RETRY_DELAY_MS,
      input.maxAttempts ?? ctx.maxAttempts,
    );
  }

  const updated = await ctx.store.updateContextFactExtractionJob({
    jobId: job.id,
    status: "completed",
    completedAt: now,
    claimedAt: null,
    lastError: null,
  });
  await ctx.store.createAuditLogEntry({
    ownerUserId: job.ownerUserId,
    action: "context_fact_extraction_job.completed",
    entityType: "context_fact_extraction_job",
    entityId: job.id,
    metadataJson: {
      messageLength: job.message.length,
      candidateCount: validated.validCandidates.length,
      invalidCandidateCount: validated.invalidCandidateCount,
      createdSuggestionCount,
      existingSuggestionCount,
      suppressedCandidateCount,
      ...adapterProvenance(ctx.extractionAdapter),
    },
  });

  return {
    job: updated,
    outcome: "completed",
    createdSuggestionCount,
    existingSuggestionCount,
    invalidCandidateCount: validated.invalidCandidateCount,
    suppressedCandidateCount,
  };
}

async function enqueueContextFactExtractionJob(
  ctx: ProcessorContext,
  input: EnqueueContextFactExtractionJobInput,
): Promise<EnqueueContextFactExtractionJobResult> {
  const ownerUserId = input.ownerUserId.trim();
  const message = input.message.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (!ownerUserId || !message || !idempotencyKey) {
    throw new Error("Owner, message, and idempotency key are required.");
  }

  const existing = await ctx.store.findContextFactExtractionJobByIdempotencyKey(idempotencyKey);
  if (existing) {
    if (existing.ownerUserId !== ownerUserId) {
      throw new Error("Context Fact extraction idempotency key belongs to another owner.");
    }
    return { job: existing, created: false };
  }

  let job: ContextFactExtractionJob;
  try {
    job = await ctx.store.createContextFactExtractionJob({
      ownerUserId,
      message,
      status: "pending",
      attempts: 0,
      lastError: null,
      idempotencyKey,
      runAfter: input.runAfter ?? new Date(),
      claimedAt: null,
      completedAt: null,
    });
  } catch (error) {
    // Concurrent replay can race the pre-read; the unique idempotency key remains the source
    // of truth and the losing enqueue reuses the winner's durable row.
    const raced = await ctx.store.findContextFactExtractionJobByIdempotencyKey(idempotencyKey);
    if (raced) {
      if (raced.ownerUserId !== ownerUserId) {
        throw new Error("Context Fact extraction idempotency key belongs to another owner.");
      }
      return { job: raced, created: false };
    }
    throw error;
  }

  await ctx.store.createAuditLogEntry({
    ownerUserId,
    action: "context_fact_extraction_job.enqueue",
    entityType: "context_fact_extraction_job",
    entityId: job.id,
    metadataJson: { messageLength: message.length },
  });
  return { job, created: true };
}

export function createContextFactExtractionProcessor(
  store: ContextFactExtractionJobStore,
  options: CreateContextFactExtractionProcessorOptions = {},
) {
  const ctx: ProcessorContext = {
    store,
    extractionAdapter:
      options.extractionAdapter ?? createDeterministicContextFactExtractionAdapter(),
    maxAttempts: options.maxAttempts ?? DEFAULT_CONTEXT_FACT_EXTRACTION_MAX_ATTEMPTS,
  };

  return {
    enqueueContextFactExtractionJob: (input: EnqueueContextFactExtractionJobInput) =>
      enqueueContextFactExtractionJob(ctx, input),
    claimNextContextFactExtractionJob: (input: { now?: Date } = {}) =>
      store.claimNextContextFactExtractionJob({ now: input.now ?? new Date() }),
    claimContextFactExtractionJob: (input: { jobId: string; now?: Date }) =>
      store.claimContextFactExtractionJob({ jobId: input.jobId, now: input.now ?? new Date() }),
    getContextFactExtractionJob: (jobId: string) => store.getContextFactExtractionJob(jobId),
    processContextFactExtractionJob: (input: ProcessContextFactExtractionJobInput) =>
      processContextFactExtractionJob(ctx, input),
  };
}
