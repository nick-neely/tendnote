import { createMemorySchema, decideExtraction, type Memory } from "@tendnote/domain";
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
export function createExtractionProcessor(store: ExtractionJobStore) {
  async function failJob(
    job: ProcessExtractionJobResult["job"],
    message: string,
    ownerUserId: string | null,
    now: Date,
    retryDelayMs: number,
  ): Promise<ProcessExtractionJobResult> {
    const updated = await store.updateExtractionJob({
      jobId: job.id,
      status: "failed",
      lastError: message,
      // Make the failure retryable after a backoff without duplicating work.
      runAfter: new Date(now.getTime() + retryDelayMs),
      claimedAt: null,
    });

    if (ownerUserId) {
      await store.createAuditLogEntry({
        ownerUserId,
        action: "extraction_job.failed",
        entityType: "extraction_job",
        entityId: job.id,
        metadataJson: { sourceRecordId: job.sourceRecordId, error: message },
      });
    }

    return { job: updated, outcome: "failed", error: message, suggestedMemories: [] };
  }

  return {
    /**
     * Idempotently enqueues a Postgres-owned extraction job for a source record.
     * Re-enqueuing the same source record returns the existing job rather than
     * creating a duplicate (one job per source record via the idempotency key).
     */
    async enqueueExtractionJob(
      input: EnqueueExtractionJobInput,
    ): Promise<EnqueueExtractionJobResult> {
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
    },

    /**
     * Claims the next due job for queue-less polling (cron/manual). Returns null
     * when nothing is claimable.
     */
    async claimNextExtractionJob(input: { now?: Date } = {}) {
      return store.claimNextExtractionJob({ now: input.now ?? new Date() });
    },

    async processExtractionJob(
      input: ProcessExtractionJobInput,
    ): Promise<ProcessExtractionJobResult> {
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
        return failJob(job, "Source record not found.", null, now, retryDelayMs);
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
        const updated = await store.updateExtractionJob({
          jobId: job.id,
          status: "skipped",
          completedAt: now,
        });

        await store.createAuditLogEntry({
          ownerUserId,
          action: "extraction_job.skipped",
          entityType: "extraction_job",
          entityId: job.id,
          metadataJson: { sourceRecordId: sourceRecord.id, reason: decision.reason },
        });

        return { job: updated, outcome: "skipped", reason: decision.reason, suggestedMemories: [] };
      }

      if (decision.action === "delay") {
        const updated = await store.updateExtractionJob({
          jobId: job.id,
          status: "pending",
          runAfter: new Date(now.getTime() + retryDelayMs),
          claimedAt: null,
        });

        await store.createAuditLogEntry({
          ownerUserId,
          action: "extraction_job.delayed",
          entityType: "extraction_job",
          entityId: job.id,
          metadataJson: { sourceRecordId: sourceRecord.id, reason: decision.reason },
        });

        return { job: updated, outcome: "delayed", reason: decision.reason, suggestedMemories: [] };
      }

      try {
        // Idempotency: never create a second suggested memory for a person who
        // already has one from this source record (covers retries and the
        // partial re-runs below).
        const existingMemories = await store.listMemoriesForSourceRecord({
          sourceRecordId: sourceRecord.id,
        });
        const personIdsWithMemory = new Set(existingMemories.map((memory) => memory.personId));
        const suggestedMemories: Memory[] = [];

        for (const link of links) {
          if (personIdsWithMemory.has(link.personId)) {
            continue;
          }

          const memory = await store.createMemory(
            // Suggested memories carry source-record provenance and stay tentative
            // until reviewed (ADR 0002, ADR 0022).
            createMemorySchema.parse({
              personId: link.personId,
              ownerUserId,
              sourceRecordId: sourceRecord.id,
              memoryType: "context",
              // Deterministic/manual extraction reuses the retained content as a
              // tentative suggestion; LLM extraction is a later slice (ADR 0020).
              content: sourceRecord.content,
              status: "suggested",
              importance: sourceRecord.importance,
              sensitivity: sourceRecord.sensitivity,
              confidence: sourceRecord.confidence,
              scope: "private",
            }),
          );

          suggestedMemories.push(memory);
          personIdsWithMemory.add(link.personId);

          await store.createAuditLogEntry({
            ownerUserId,
            action: "memory.suggest",
            entityType: "memory",
            entityId: memory.id,
            metadataJson: {
              personId: link.personId,
              sourceRecordId: sourceRecord.id,
              extractionJobId: job.id,
            },
          });
        }

        // Facts tied to unresolved mentions wait (ADR 0036): keep the job alive
        // so resolved mentions get extracted on a later run, without re-suggesting
        // for people already processed above.
        if (unresolvedMentionCount > 0) {
          const updated = await store.updateExtractionJob({
            jobId: job.id,
            status: "pending",
            runAfter: new Date(now.getTime() + retryDelayMs),
            claimedAt: null,
          });

          // Only record a partial outcome when this run actually made progress.
          // A record stuck behind a permanently-unresolved mention re-runs
          // silently rather than appending an audit entry on every no-op poll.
          if (suggestedMemories.length > 0) {
            await store.createAuditLogEntry({
              ownerUserId,
              action: "extraction_job.partial",
              entityType: "extraction_job",
              entityId: job.id,
              metadataJson: {
                sourceRecordId: sourceRecord.id,
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
            sourceRecordId: sourceRecord.id,
            suggestedMemoryCount: suggestedMemories.length,
          },
        });

        return { job: updated, outcome: "completed", suggestedMemories };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        return failJob(job, message, ownerUserId, now, retryDelayMs);
      }
    },
  };
}
