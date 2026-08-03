import {
  type ContextFactExtractionAdapter,
  type ContextFactExtractionJob,
  ContextFactValidationError,
  createDeterministicContextFactExtractionAdapter,
  MAX_PENDING_CONTEXT_FACT_SUGGESTIONS_PER_OWNER,
  validateContextFactExtractionCandidates,
} from "@tendnote/domain";
import type { AffectedScope } from "../affected-scopes";
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
    affectedScopes: [],
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
      ? { completedAt: now, claimedAt: null, claimToken: null, message: null }
      : { runAfter: new Date(now.getTime() + retryDelayMs), claimedAt: null, claimToken: null }),
    expectedClaimToken: job.claimToken ?? undefined,
  });

  if (!updated) {
    const current = await ctx.store.getContextFactExtractionJob(job.id);
    return emptyResult(current ?? job, current ? "not_claimable" : "not_found");
  }

  await ctx.store.createAuditLogEntry({
    ownerUserId: job.ownerUserId,
    action: deadLettered
      ? "context_fact_extraction_job.dead_lettered"
      : "context_fact_extraction_job.failed",
    entityType: "context_fact_extraction_job",
    entityId: job.id,
    metadataJson: {
      messageLength: job.message?.length ?? 0,
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

type PersistedCandidateCounts = {
  createdSuggestionCount: number;
  existingSuggestionCount: number;
  suppressedCandidateCount: number;
  affectedScopes: AffectedScope[];
};

async function persistValidCandidates(
  ctx: ProcessorContext,
  job: ContextFactExtractionJob,
  validated: ReturnType<typeof validateContextFactExtractionCandidates>,
): Promise<PersistedCandidateCounts> {
  const contextFactQueries = createContextFactQueries(ctx.store, {
    maxPendingSuggestedContextFacts: MAX_PENDING_CONTEXT_FACT_SUGGESTIONS_PER_OWNER,
    resolveVerifiedCaller: async () => job.ownerUserId,
  });
  let createdSuggestionCount = 0;
  let existingSuggestionCount = 0;
  let suppressedCandidateCount = 0;
  const affectedScopes = new Map<string, AffectedScope>();

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
        for (const scope of result.affectedScopes) {
          affectedScopes.set(JSON.stringify(scope), scope);
        }
      } else {
        existingSuggestionCount += 1;
      }
    } catch (error) {
      // Dismissal suppression and the pending-owner cap are deterministic review policy, not
      // queue failures. Other persistence errors must retry the whole job.
      if (!(error instanceof ContextFactValidationError)) throw error;
      suppressedCandidateCount += 1;
    }
  }

  return {
    createdSuggestionCount,
    existingSuggestionCount,
    suppressedCandidateCount,
    affectedScopes: [...affectedScopes.values()],
  };
}

type ClaimedContextFactExtractionJob = {
  job: ContextFactExtractionJob;
  claimToken?: string;
};

async function claimForProcessing(
  ctx: ProcessorContext,
  input: ProcessContextFactExtractionJobInput,
): Promise<ClaimedContextFactExtractionJob | ProcessContextFactExtractionJobResult> {
  const now = input.now ?? new Date();
  const existingJob = await ctx.store.getContextFactExtractionJob(input.jobId);
  if (!existingJob) throw new Error("Context Fact extraction job not found.");

  let job = existingJob;
  let claimToken: string | undefined;
  if (job.status !== "running") {
    if (input.claim === false) return emptyResult(job, "not_claimable");
    const claimed = await ctx.store.claimContextFactExtractionJob({ jobId: job.id, now });
    if (!claimed) return emptyResult(job, "not_claimable");
    job = claimed;
    claimToken = claimed.claimToken ?? undefined;
  } else {
    if (input.claim !== false || !input.claimToken || job.claimToken !== input.claimToken) {
      return emptyResult(job, "not_claimable");
    }
    claimToken = input.claimToken;
  }

  return { job, claimToken };
}

type PreparedContextFactExtraction = {
  validated: ReturnType<typeof validateContextFactExtractionCandidates>;
  counts: PersistedCandidateCounts;
};

async function prepareExtraction(
  ctx: ProcessorContext,
  job: ContextFactExtractionJob,
): Promise<PreparedContextFactExtraction | ProcessContextFactExtractionJobResult> {
  // The adapter receives only this job's bounded message. No owner history or other
  // domain records are loaded here, so the current-message boundary is structural.
  if (job.message === null) return emptyResult(job, "not_claimable");
  const adapterResult = await ctx.extractionAdapter.extractCandidates({ message: job.message });
  const validated = validateContextFactExtractionCandidates(adapterResult, {
    message: job.message,
  });
  return {
    validated,
    counts: await persistValidCandidates(ctx, job, validated),
  };
}

async function completeExtraction(
  ctx: ProcessorContext,
  input: {
    job: ContextFactExtractionJob;
    claimToken?: string;
    validated: ReturnType<typeof validateContextFactExtractionCandidates>;
    counts: PersistedCandidateCounts;
    now: Date;
  },
): Promise<ProcessContextFactExtractionJobResult> {
  const { job, claimToken, validated, counts, now } = input;
  const updated = await ctx.store.updateContextFactExtractionJob({
    jobId: job.id,
    status: "completed",
    completedAt: now,
    claimedAt: null,
    claimToken: null,
    lastError: null,
    message: null,
    expectedClaimToken: claimToken,
  });
  if (!updated) {
    const current = await ctx.store.getContextFactExtractionJob(job.id);
    return emptyResult(current ?? job, current ? "not_claimable" : "not_found");
  }
  await ctx.store.createAuditLogEntry({
    ownerUserId: job.ownerUserId,
    action: "context_fact_extraction_job.completed",
    entityType: "context_fact_extraction_job",
    entityId: job.id,
    metadataJson: {
      messageLength: job.message?.length ?? 0,
      candidateCount: validated.validCandidates.length,
      invalidCandidateCount: validated.invalidCandidateCount,
      ...counts,
      ...adapterProvenance(ctx.extractionAdapter),
    },
  });

  return {
    job: updated,
    outcome: "completed",
    createdSuggestionCount: counts.createdSuggestionCount,
    existingSuggestionCount: counts.existingSuggestionCount,
    invalidCandidateCount: validated.invalidCandidateCount,
    suppressedCandidateCount: counts.suppressedCandidateCount,
    affectedScopes: counts.affectedScopes,
  };
}

async function processContextFactExtractionJob(
  ctx: ProcessorContext,
  input: ProcessContextFactExtractionJobInput,
): Promise<ProcessContextFactExtractionJobResult> {
  const now = input.now ?? new Date();
  const claimed = await claimForProcessing(ctx, input);
  if ("outcome" in claimed) return claimed;

  let prepared: PreparedContextFactExtraction | ProcessContextFactExtractionJobResult;
  try {
    prepared = await prepareExtraction(ctx, claimed.job);
  } catch (error) {
    return failJob(
      ctx,
      claimed.job,
      error,
      now,
      input.retryDelayMs ?? DEFAULT_CONTEXT_FACT_EXTRACTION_RETRY_DELAY_MS,
      input.maxAttempts ?? ctx.maxAttempts,
    );
  }
  if ("outcome" in prepared) return prepared;
  return completeExtraction(ctx, {
    job: claimed.job,
    claimToken: claimed.claimToken,
    validated: prepared.validated,
    counts: prepared.counts,
    now,
  });
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
      claimToken: null,
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
