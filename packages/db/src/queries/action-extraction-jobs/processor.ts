import {
  composeExtractedActionNotes,
  createDeterministicSuggestedActionExtractionAdapter,
  decideActionExtraction,
  extractedActionDedupeKey,
  resolveExtractedActionScope,
  type SourceRecord,
  type SuggestedActionExtractionAdapter,
  validateSuggestedActionCandidates,
} from "@tendnote/domain";
import { createSuggestedGeneralActionReview } from "../general-actions/review";
import type {
  ActionExtractionJobStore,
  CreateActionExtractionProcessorOptions,
  EnqueueActionExtractionJobInput,
  EnqueueActionExtractionJobResult,
  ProcessActionExtractionJobInput,
  ProcessActionExtractionJobResult,
} from "./types";

/**
 * Default backoff for a failed action extraction job, so a transient error retries
 * without hot-looping. Actions are not person-gated, so there is no "waiting on mention
 * resolution" delay path here — a job either completes, skips, or fails-and-retries.
 */
export const DEFAULT_ACTION_EXTRACTION_RETRY_DELAY_MS = 5 * 60 * 1000;

function idempotencyKeyFor(sourceRecordId: string) {
  return `action:source_record:${sourceRecordId}`;
}

/**
 * Phase 5 action extraction processor (ADRs 0018, 0151, 0152). It reads a captured
 * source record and proposes review-gated Suggested General Actions through the shared
 * `suggestGeneralAction` seam — never active Actions, never hidden action metadata on
 * the source record. It runs as a Postgres-owned job that can be enqueued, claimed,
 * retried, and processed idempotently: one job per source record (idempotency key), and
 * within a run each proposal is deduped by normalized title against the actions already
 * grounded in that record, so a retry or redelivery never double-proposes and a
 * dismissed/ignored proposal is not reintroduced. Restricted content stays out of
 * proactive suggestions and extracted proposals default private, fail-closed (ADRs 0058,
 * 0140, 0153).
 */
type ActionExtractionContext = {
  store: ActionExtractionJobStore;
  extractionAdapter: SuggestedActionExtractionAdapter;
  review: ReturnType<typeof createSuggestedGeneralActionReview>;
};

/** Fail the job and requeue it on a backoff so a transient error retries. */
async function failJob(
  ctx: ActionExtractionContext,
  job: ProcessActionExtractionJobResult["job"],
  message: string,
  now: Date,
  retryDelayMs: number,
): Promise<ProcessActionExtractionJobResult> {
  const updated = await ctx.store.updateActionExtractionJob({
    jobId: job.id,
    status: "failed",
    lastError: message,
    runAfter: new Date(now.getTime() + retryDelayMs),
    claimedAt: null,
  });

  return { job: updated, outcome: "failed", error: message, suggestedActionIds: [] };
}

/** Terminal "skip" outcome: this record cannot yield proactive action suggestions. */
async function skipJob(
  ctx: ActionExtractionContext,
  job: ProcessActionExtractionJobResult["job"],
  now: Date,
  reason: string,
): Promise<ProcessActionExtractionJobResult> {
  const updated = await ctx.store.updateActionExtractionJob({
    jobId: job.id,
    status: "skipped",
    completedAt: now,
  });

  return { job: updated, outcome: "skipped", reason, suggestedActionIds: [] };
}

/**
 * Runs the adapter for a claimed, extractable job and proposes the resulting Suggested
 * General Actions through the review seam. Idempotency: a proposal whose normalized
 * title already exists on an action grounded in this source record — from a retry, a
 * prior run, or a dismissed/ignored proposal — is skipped, while one record may still
 * yield several distinct actions. Every proposal is grounded in the source record, filed
 * under a matched Area if the candidate named one, defaults private (only reaching
 * household when the owner scoped the record itself to a household), and links only the
 * people the record already resolves to.
 */
async function persistSuggestedActions(
  ctx: ActionExtractionContext,
  sourceRecord: SourceRecord,
  directlyRequested: boolean | undefined,
): Promise<string[]> {
  const { store, review } = ctx;
  const ownerUserId = sourceRecord.ownerUserId;

  const [existing, links, areas] = await Promise.all([
    store.listGeneralActionsForSourceRecord({ ownerUserId, sourceRecordId: sourceRecord.id }),
    store.listSourceRecordPeople({ sourceRecordId: sourceRecord.id }),
    store.listAreasForOwner({ ownerUserId }),
  ]);

  const existingKeys = new Set(existing.map((action) => extractedActionDedupeKey(action.title)));

  const resolvedPeople = (
    await Promise.all(
      links.map(async (link) => {
        const person = await store.getPerson({ ownerUserId, personId: link.personId });
        return person ? { id: person.id, displayName: person.displayName } : null;
      }),
    )
  ).filter((person) => person !== null);

  const adapterResult = await ctx.extractionAdapter.extractActions({
    sourceRecord: {
      id: sourceRecord.id,
      content: sourceRecord.content,
      ownerUserId: sourceRecord.ownerUserId,
      sensitivity: sourceRecord.sensitivity,
      scope: sourceRecord.scope,
      importance: sourceRecord.importance,
    },
    resolvedPeople,
    availableAreas: areas.map((area) => ({ id: area.id, name: area.name })),
  });

  const { validCandidates } = validateSuggestedActionCandidates(adapterResult, {
    resolvedPeople,
    availableAreas: areas.map((area) => ({ id: area.id, name: area.name })),
  });

  const suggestedActionIds: string[] = [];

  for (const candidate of validCandidates) {
    const dedupeKey = extractedActionDedupeKey(candidate.title);
    if (existingKeys.has(dedupeKey)) {
      continue;
    }

    const { scope, householdId } = resolveExtractedActionScope({
      sourceRecord: { scope: sourceRecord.scope, householdId: sourceRecord.householdId ?? null },
      candidateScope: candidate.scope,
    });

    const result = await review.suggestGeneralAction({
      ownerUserId,
      title: candidate.title,
      notes: composeExtractedActionNotes(candidate),
      dueAt: candidate.dueAt ?? null,
      deferUntil: candidate.deferUntil ?? null,
      recurrence: candidate.recurrence ?? null,
      assetHints: candidate.assetHints ?? [],
      personIds: candidate.personIds ?? [],
      areaId: candidate.areaId ?? null,
      scope,
      householdId,
      sourceRecordId: sourceRecord.id,
      directlyRequested,
    });

    suggestedActionIds.push(result.action.id);
    existingKeys.add(dedupeKey);
  }

  return suggestedActionIds;
}

/**
 * Idempotently enqueues a Postgres-owned action extraction job for a source record.
 * Re-enqueuing the same source record returns the existing job (one action job per
 * source record via the namespaced idempotency key) rather than creating a duplicate.
 */
async function enqueueActionExtractionJob(
  ctx: ActionExtractionContext,
  input: EnqueueActionExtractionJobInput,
): Promise<EnqueueActionExtractionJobResult> {
  const { store } = ctx;
  const sourceRecord = await store.getSourceRecordById(input.sourceRecordId);

  if (!sourceRecord) {
    throw new Error("Source record not found.");
  }

  const idempotencyKey = idempotencyKeyFor(sourceRecord.id);
  const existing = await store.findActionExtractionJobByIdempotencyKey(idempotencyKey);

  if (existing) {
    return { job: existing, created: false };
  }

  const job = await store.createActionExtractionJob({
    sourceRecordId: sourceRecord.id,
    status: "pending",
    attempts: 0,
    lastError: null,
    idempotencyKey,
    runAfter: input.runAfter ?? new Date(),
  });

  return { job, created: true };
}

/**
 * Claims an extractable job (unless asked not to), runs the extraction decision, and
 * dispatches to the matching outcome: skip, fail-and-retry, or extract-and-complete. A
 * job already `running` is processed without re-claiming; anything not claimable returns
 * early untouched.
 */
async function processActionExtractionJob(
  ctx: ActionExtractionContext,
  input: ProcessActionExtractionJobInput,
): Promise<ProcessActionExtractionJobResult> {
  const { store } = ctx;
  const now = input.now ?? new Date();
  const retryDelayMs = input.retryDelayMs ?? DEFAULT_ACTION_EXTRACTION_RETRY_DELAY_MS;
  const claim = input.claim ?? true;

  const existingJob = await store.getActionExtractionJob(input.jobId);

  if (!existingJob) {
    throw new Error("Action extraction job not found.");
  }

  let job = existingJob;

  if (job.status !== "running") {
    if (!claim) {
      return { job, outcome: "not_claimable", suggestedActionIds: [] };
    }

    const claimed = await store.claimActionExtractionJob({ jobId: job.id, now });

    if (!claimed) {
      return { job, outcome: "not_claimable", suggestedActionIds: [] };
    }

    job = claimed;
  }

  const sourceRecord = await store.getSourceRecordById(job.sourceRecordId);

  if (!sourceRecord) {
    return failJob(ctx, job, "Source record not found.", now, retryDelayMs);
  }

  const decision = decideActionExtraction({
    sourceRecord,
    directlyRequested: input.directlyRequested,
  });

  if (decision.action === "skip") {
    return skipJob(ctx, job, now, decision.reason);
  }

  try {
    const suggestedActionIds = await persistSuggestedActions(
      ctx,
      sourceRecord,
      input.directlyRequested,
    );

    const updated = await store.updateActionExtractionJob({
      jobId: job.id,
      status: "completed",
      completedAt: now,
    });

    return { job: updated, outcome: "completed", suggestedActionIds };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failJob(ctx, job, message, now, retryDelayMs);
  }
}

export function createActionExtractionProcessor(
  store: ActionExtractionJobStore,
  options: CreateActionExtractionProcessorOptions = {},
) {
  // The no-options path keeps deterministic behavior (no actions inferred without a
  // model) for unit harnesses and explicit local fallback. The exported Drizzle runtime
  // injects the production LLM adapter instead.
  const ctx: ActionExtractionContext = {
    store,
    extractionAdapter:
      options.extractionAdapter ?? createDeterministicSuggestedActionExtractionAdapter(),
    review: createSuggestedGeneralActionReview(store),
  };

  return {
    enqueueActionExtractionJob: (input: EnqueueActionExtractionJobInput) =>
      enqueueActionExtractionJob(ctx, input),
    claimNextActionExtractionJob: (input: { now?: Date } = {}) =>
      store.claimNextActionExtractionJob({ now: input.now ?? new Date() }),
    claimActionExtractionJob: (input: { jobId: string; now?: Date }) =>
      store.claimActionExtractionJob({ jobId: input.jobId, now: input.now ?? new Date() }),
    getActionExtractionJob: (jobId: string) => store.getActionExtractionJob(jobId),
    processActionExtractionJob: (input: ProcessActionExtractionJobInput) =>
      processActionExtractionJob(ctx, input),
  };
}
