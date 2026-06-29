import {
  createDeterministicSuggestedMemoryExtractionAdapter,
  createMemorySchema,
  decideExtraction,
  type Memory,
  type SuggestedMemoryExtractionAdapter,
  sourceRecordAutoApprovesMemories,
  stricterSensitivity,
  validateSuggestedMemoryCandidates,
} from "@tendnote/domain";
import type { ApprovedMemoryEmbeddingScheduler } from "../memories/types";
import type {
  EnqueueExtractionJobInput,
  EnqueueExtractionJobResult,
  ExtractionJobStore,
  ProcessExtractionJobInput,
  ProcessExtractionJobResult,
} from "./types";

// Default backoff for jobs that are requeued because they are waiting on mention
// resolution or because part of a multi-person record could not be processed yet.
export const DEFAULT_EXTRACTION_RETRY_DELAY_MS = 5 * 60 * 1000;

function idempotencyKeyFor(sourceRecordId: string) {
  return `source_record:${sourceRecordId}`;
}

function scrubFailureMessage(message: string) {
  return message.replace(/\s+/g, " ").slice(0, 200);
}

function memoryCandidateKey(input: { personId: string; content: string }) {
  return `${input.personId}:${input.content.trim().toLowerCase()}`;
}

/**
 * Phase 1A extraction processor: deterministic/manual, no LLM yet (ADR 0020).
 *
 * Source records are saved synchronously elsewhere; this turns eligible records
 * into suggested memories through Postgres-owned extraction jobs (ADR 0018) that
 * can be enqueued, claimed, retried, and processed idempotently (ADR 0017). All
 * product rules live here in the shared layer so web, Eve, cron, and queue
 * triggers stay thin and behave identically (ADR 0019). Suggested memories always
 * keep source-record provenance (ADR 0022), extraction is person-aware and may
 * partially process resolved people while unresolved mentions wait (ADR 0036),
 * restricted content stays out of proactive suggestions (ADR 0058), and every
 * outcome writes an internal audit entry (ADR 0014, ADR 0053).
 *
 * Resolution-triggered re-extraction and bounded retry/dead-lettering are later
 * slices; Phase 1A waits by leaving partial/failed jobs claimable on a backoff.
 */
export type CreateExtractionProcessorOptions = {
  extractionAdapter?: SuggestedMemoryExtractionAdapter;
  // Schedules embedding for a memory that extraction saves as approved (because the
  // user pre-approved the note). Suggested memories are never embedded until reviewed,
  // so this only fires on the auto-approve path. Omitted in unit harnesses.
  scheduleApprovedMemoryEmbedding?: ApprovedMemoryEmbeddingScheduler;
};

/**
 * Everything the extraction steps need from their environment: the owner-scoped
 * store and the configured adapter plus the optional approved-memory embedding
 * scheduler. Bundling it lets each step live at module scope as a focused,
 * directly testable function instead of a closure buried in the factory.
 */
type ExtractionContext = {
  store: ExtractionJobStore;
  extractionAdapter: SuggestedMemoryExtractionAdapter;
  scheduleApprovedMemoryEmbedding?: ApprovedMemoryEmbeddingScheduler;
};

function adapterProvenance(adapter: SuggestedMemoryExtractionAdapter) {
  return {
    adapterKind: adapter.kind,
    ...(adapter.model ? { extractionModel: adapter.model } : {}),
    ...(adapter.promptVersion ? { promptVersion: adapter.promptVersion } : {}),
  };
}

/** Fail the job and requeue it on a backoff so a transient error retries. */
async function failJob(
  ctx: ExtractionContext,
  job: ProcessExtractionJobResult["job"],
  message: string,
  ownerUserId: string | null,
  now: Date,
  retryDelayMs: number,
  metadata: Record<string, unknown> = {},
): Promise<ProcessExtractionJobResult> {
  const updated = await ctx.store.updateExtractionJob({
    jobId: job.id,
    status: "failed",
    lastError: message,
    // Make the failure retryable after a backoff without duplicating work.
    runAfter: new Date(now.getTime() + retryDelayMs),
    claimedAt: null,
  });

  if (ownerUserId) {
    await ctx.store.createAuditLogEntry({
      ownerUserId,
      action: "extraction_job.failed",
      entityType: "extraction_job",
      entityId: job.id,
      metadataJson: {
        sourceRecordId: job.sourceRecordId,
        extractionJobId: job.id,
        failureReason: "adapter_error",
        failureMessage: scrubFailureMessage(message),
        ...adapterProvenance(ctx.extractionAdapter),
        ...metadata,
      },
    });
  }

  return { job: updated, outcome: "failed", error: message, suggestedMemories: [] };
}

/** Terminal "skip" outcome: nothing to extract for this record. */
async function skipJob(
  ctx: ExtractionContext,
  job: ProcessExtractionJobResult["job"],
  sourceRecordId: string,
  ownerUserId: string,
  now: Date,
  reason: string | undefined,
): Promise<ProcessExtractionJobResult> {
  const updated = await ctx.store.updateExtractionJob({
    jobId: job.id,
    status: "skipped",
    completedAt: now,
  });

  await ctx.store.createAuditLogEntry({
    ownerUserId,
    action: "extraction_job.skipped",
    entityType: "extraction_job",
    entityId: job.id,
    metadataJson: { sourceRecordId, reason },
  });

  return { job: updated, outcome: "skipped", reason, suggestedMemories: [] };
}

/** Requeue the job on a backoff because it cannot make progress yet. */
async function delayJob(
  ctx: ExtractionContext,
  job: ProcessExtractionJobResult["job"],
  sourceRecordId: string,
  ownerUserId: string,
  now: Date,
  retryDelayMs: number,
  reason: string | undefined,
): Promise<ProcessExtractionJobResult> {
  const updated = await ctx.store.updateExtractionJob({
    jobId: job.id,
    status: "pending",
    runAfter: new Date(now.getTime() + retryDelayMs),
    claimedAt: null,
  });

  await ctx.store.createAuditLogEntry({
    ownerUserId,
    action: "extraction_job.delayed",
    entityType: "extraction_job",
    entityId: job.id,
    metadataJson: { sourceRecordId, reason },
  });

  return { job: updated, outcome: "delayed", reason, suggestedMemories: [] };
}

/**
 * Runs the extraction adapter for a claimed, extractable job and persists the
 * resulting suggested memories. Idempotency: a candidate already saved for this
 * person/source record (from a retry, a prior partial run, or a dismissed
 * suggestion) is skipped, while one note may still split into several atomic
 * memories for the same person. Pre-approved notes save confirmed memories and
 * schedule embedding; suggestions stay tentative. Returns what it created plus
 * the audit provenance the caller folds into the job-finalization entry.
 */
async function persistSuggestedMemories(
  ctx: ExtractionContext,
  job: ProcessExtractionJobResult["job"],
  sourceRecord: NonNullable<Awaited<ReturnType<ExtractionJobStore["getSourceRecordById"]>>>,
  ownerUserId: string,
  links: Awaited<ReturnType<ExtractionJobStore["listSourceRecordPeople"]>>,
  now: Date,
): Promise<{ suggestedMemories: Memory[]; provenance: Record<string, unknown> }> {
  const { store } = ctx;
  const existingMemories = await store.listMemoriesForSourceRecord({
    sourceRecordId: sourceRecord.id,
  });
  const existingCandidateKeys = new Set(existingMemories.map(memoryCandidateKey));
  const suggestedMemories: Memory[] = [];
  const autoApprove = sourceRecordAutoApprovesMemories(sourceRecord.metadataJson);

  const resolvedPeople = (
    await Promise.all(
      links.map(async (link) => {
        const person = await store.getPerson({ ownerUserId, personId: link.personId });

        return person
          ? { id: person.id, displayName: person.displayName, linkPersonId: link.personId }
          : null;
      }),
    )
  ).filter((person) => person !== null);

  const adapterResult = await ctx.extractionAdapter.extractCandidates({
    sourceRecord,
    resolvedPeople: resolvedPeople.map((person) => ({
      id: person.id,
      displayName: person.displayName,
    })),
  });
  const { validCandidates, invalidCandidateCount } = validateSuggestedMemoryCandidates(
    adapterResult,
    { resolvedPeople },
  );
  const candidateCount = Array.isArray(adapterResult.candidates)
    ? adapterResult.candidates.length
    : 0;
  let rejectedCandidateCount = invalidCandidateCount;

  for (const candidate of validCandidates) {
    if (existingCandidateKeys.has(memoryCandidateKey(candidate))) {
      rejectedCandidateCount += 1;
    }
  }
  const provenance = {
    ...adapterProvenance(ctx.extractionAdapter),
    sourceRecordId: sourceRecord.id,
    extractionJobId: job.id,
    candidateCount,
    invalidCandidateCount,
    rejectedCandidateCount,
  };

  for (const candidate of validCandidates) {
    const candidateKey = memoryCandidateKey(candidate);

    if (existingCandidateKeys.has(candidateKey)) {
      continue;
    }

    const memory = await store.createMemory(
      // Memories carry source-record provenance (ADR 0002, ADR 0022). They stay
      // tentative until reviewed unless the note was pre-approved, in which case
      // they are saved confirmed with an approval timestamp.
      createMemorySchema.parse({
        personId: candidate.personId,
        ownerUserId,
        sourceRecordId: sourceRecord.id,
        memoryType: candidate.memoryType,
        content: candidate.content,
        status: autoApprove ? "approved" : "suggested",
        importance: candidate.importance ?? sourceRecord.importance,
        sensitivity: stricterSensitivity(sourceRecord.sensitivity, candidate.sensitivity),
        confidence: candidate.confidence ?? sourceRecord.confidence,
        scope: "private",
        ...(autoApprove ? { approvedAt: now } : {}),
      }),
    );

    suggestedMemories.push(memory);
    existingCandidateKeys.add(candidateKey);

    if (autoApprove) {
      await ctx.scheduleApprovedMemoryEmbedding?.({
        ownerUserId,
        recordKind: "memory",
        recordId: memory.id,
      });
    }

    await store.createAuditLogEntry({
      ownerUserId,
      action: autoApprove ? "memory.auto_approved" : "memory.suggest",
      entityType: "memory",
      entityId: memory.id,
      metadataJson: {
        ...provenance,
        personId: candidate.personId,
      },
    });
  }

  return { suggestedMemories, provenance };
}

/**
 * Closes out an extraction run. Facts tied to unresolved mentions keep the job
 * alive on a backoff (ADR 0036) so resolved mentions extract on a later run
 * without re-suggesting for people already processed; a partial audit entry is
 * only written when this run actually produced something, so a job stuck behind
 * a permanently-unresolved mention re-runs silently instead of logging each
 * no-op poll. Otherwise the job completes.
 */
async function finalizeExtraction(
  ctx: ExtractionContext,
  job: ProcessExtractionJobResult["job"],
  sourceRecordId: string,
  ownerUserId: string,
  unresolvedMentionCount: number,
  suggestedMemories: Memory[],
  provenance: Record<string, unknown>,
  now: Date,
  retryDelayMs: number,
): Promise<ProcessExtractionJobResult> {
  const { store } = ctx;

  if (unresolvedMentionCount > 0) {
    const updated = await store.updateExtractionJob({
      jobId: job.id,
      status: "pending",
      runAfter: new Date(now.getTime() + retryDelayMs),
      claimedAt: null,
    });

    if (suggestedMemories.length > 0) {
      await store.createAuditLogEntry({
        ownerUserId,
        action: "extraction_job.partial",
        entityType: "extraction_job",
        entityId: job.id,
        metadataJson: {
          ...provenance,
          sourceRecordId,
          suggestedMemoryCount: suggestedMemories.length,
          unresolvedMentionCount,
        },
      });
    }

    return { job: updated, outcome: "partial", suggestedMemories };
  }

  const updated = await store.updateExtractionJob({
    jobId: job.id,
    status: "completed",
    completedAt: now,
  });

  await store.createAuditLogEntry({
    ownerUserId,
    action: "extraction_job.completed",
    entityType: "extraction_job",
    entityId: job.id,
    metadataJson: {
      ...provenance,
      sourceRecordId,
      suggestedMemoryCount: suggestedMemories.length,
    },
  });

  return { job: updated, outcome: "completed", suggestedMemories };
}

/**
 * Idempotently enqueues a Postgres-owned extraction job for a source record.
 * Re-enqueuing the same source record returns the existing job rather than
 * creating a duplicate (one job per source record via the idempotency key).
 */
async function enqueueExtractionJob(
  ctx: ExtractionContext,
  input: EnqueueExtractionJobInput,
): Promise<EnqueueExtractionJobResult> {
  const { store } = ctx;
  const sourceRecord = await store.getSourceRecordById(input.sourceRecordId);

  if (!sourceRecord) {
    throw new Error("Source record not found.");
  }

  const idempotencyKey = idempotencyKeyFor(sourceRecord.id);
  const existing = await store.findExtractionJobByIdempotencyKey(idempotencyKey);

  if (existing) {
    return { job: existing, created: false };
  }

  const job = await store.createExtractionJob({
    sourceRecordId: sourceRecord.id,
    status: "pending",
    attempts: 0,
    lastError: null,
    idempotencyKey,
    runAfter: input.runAfter ?? new Date(),
  });

  await store.createAuditLogEntry({
    ownerUserId: sourceRecord.ownerUserId,
    action: "extraction_job.enqueue",
    entityType: "extraction_job",
    entityId: job.id,
    metadataJson: { sourceRecordId: sourceRecord.id },
  });

  return { job, created: true };
}

/**
 * Claims an extractable job (unless asked not to), runs the extraction decision,
 * and dispatches to the matching outcome: skip, delay, fail, or extract-and-
 * finalize. A job already `running` is processed without re-claiming; anything
 * not claimable returns early untouched.
 */
async function processExtractionJob(
  ctx: ExtractionContext,
  input: ProcessExtractionJobInput,
): Promise<ProcessExtractionJobResult> {
  const { store } = ctx;
  const now = input.now ?? new Date();
  const retryDelayMs = input.retryDelayMs ?? DEFAULT_EXTRACTION_RETRY_DELAY_MS;
  const claim = input.claim ?? true;

  const existingJob = await store.getExtractionJob(input.jobId);

  if (!existingJob) {
    throw new Error("Extraction job not found.");
  }

  let job = existingJob;

  if (job.status !== "running") {
    if (!claim) {
      return { job, outcome: "not_claimable", suggestedMemories: [] };
    }

    const claimed = await store.claimExtractionJob({ jobId: job.id, now });

    if (!claimed) {
      // Either already terminal/claimed elsewhere or scheduled for later.
      return { job, outcome: "not_claimable", suggestedMemories: [] };
    }

    job = claimed;
  }

  const sourceRecord = await store.getSourceRecordById(job.sourceRecordId);

  if (!sourceRecord) {
    return failJob(ctx, job, "Source record not found.", null, now, retryDelayMs);
  }

  const ownerUserId = sourceRecord.ownerUserId;
  const [links, mentions] = await Promise.all([
    store.listSourceRecordPeople({ sourceRecordId: sourceRecord.id }),
    store.listUnresolvedMentions({ sourceRecordId: sourceRecord.id }),
  ]);
  const unresolvedMentionCount = mentions.filter(
    (mention) => mention.status === "unresolved",
  ).length;

  const decision = decideExtraction({
    sourceRecord,
    resolvedPersonCount: links.length,
    unresolvedMentionCount,
    directlyRequested: input.directlyRequested,
  });

  if (decision.action === "skip") {
    return skipJob(ctx, job, sourceRecord.id, ownerUserId, now, decision.reason);
  }

  if (decision.action === "delay") {
    return delayJob(ctx, job, sourceRecord.id, ownerUserId, now, retryDelayMs, decision.reason);
  }

  try {
    const { suggestedMemories, provenance } = await persistSuggestedMemories(
      ctx,
      job,
      sourceRecord,
      ownerUserId,
      links,
      now,
    );

    return finalizeExtraction(
      ctx,
      job,
      sourceRecord.id,
      ownerUserId,
      unresolvedMentionCount,
      suggestedMemories,
      provenance,
      now,
      retryDelayMs,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return failJob(ctx, job, message, ownerUserId, now, retryDelayMs);
  }
}

export function createExtractionProcessor(
  store: ExtractionJobStore,
  options: CreateExtractionProcessorOptions = {},
) {
  // The no-options path keeps deterministic behavior for unit harnesses and
  // explicit local fallback. The exported Drizzle runtime injects the production
  // LLM adapter instead of relying on this fallback.
  const ctx: ExtractionContext = {
    store,
    extractionAdapter:
      options.extractionAdapter ?? createDeterministicSuggestedMemoryExtractionAdapter(),
    scheduleApprovedMemoryEmbedding: options.scheduleApprovedMemoryEmbedding,
  };

  return {
    enqueueExtractionJob: (input: EnqueueExtractionJobInput) => enqueueExtractionJob(ctx, input),
    /**
     * Claims the next due job for queue-less polling (cron/manual). Returns null
     * when nothing is claimable.
     */
    claimNextExtractionJob: (input: { now?: Date } = {}) =>
      store.claimNextExtractionJob({ now: input.now ?? new Date() }),
    claimExtractionJob: (input: { jobId: string; now?: Date }) =>
      store.claimExtractionJob({ jobId: input.jobId, now: input.now ?? new Date() }),
    getExtractionJob: (jobId: string) => store.getExtractionJob(jobId),
    processExtractionJob: (input: ProcessExtractionJobInput) => processExtractionJob(ctx, input),
  };
}
