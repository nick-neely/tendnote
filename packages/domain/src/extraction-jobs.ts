import { z } from "zod";
import { JOB_CREATE_OMIT, jobQueueMechanicsShape } from "./job-queue";
import { canExtractFromSourceRecord, type SourceRecord } from "./source-records";

export const extractionJobStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);

export const extractionJobSchema = z.object({
  id: z.string(),
  sourceRecordId: z.string().min(1),
  status: extractionJobStatusSchema.default("pending"),
  ...jobQueueMechanicsShape,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createExtractionJobSchema = extractionJobSchema.omit(JOB_CREATE_OMIT);

export type ExtractionJob = z.infer<typeof extractionJobSchema>;
export type ExtractionJobStatus = z.infer<typeof extractionJobStatusSchema>;
export type CreateExtractionJobInput = z.infer<typeof createExtractionJobSchema>;

/**
 * States a Postgres-owned extraction job can be claimed from: freshly queued
 * (`pending`) or recovering from a retryable failure (`failed`). Stores share
 * this set so claim semantics stay identical across adapters (ADR 0018).
 */
export const claimableExtractionJobStatuses = [
  "pending",
  "failed",
] as const satisfies ReadonlyArray<ExtractionJobStatus>;

export type ExtractionSkipReason =
  | "source_record_not_active"
  | "restricted_content"
  | "no_linked_people";

export type ExtractionDelayReason = "awaiting_mention_resolution";

export type ExtractionDecision =
  | { action: "extract" }
  | { action: "skip"; reason: ExtractionSkipReason }
  | { action: "delay"; reason: ExtractionDelayReason };

export type DecideExtractionInput = {
  sourceRecord: Pick<SourceRecord, "status" | "sensitivity">;
  resolvedPersonCount: number;
  unresolvedMentionCount: number;
  directlyRequested?: boolean;
};

/**
 * Deterministic gate for the Phase 1A extraction processor. This is pure policy
 * (no I/O) so it can be tested directly and reused by web, Eve, cron, or queue
 * triggers that all call the same shared processor:
 *
 * - `skip` is terminal: the source record can never yield proactive suggestions
 *   in its current state (inactive, or restricted without a direct request, or
 *   nothing linked to extract for).
 * - `delay` means the record is still eligible but is waiting on mention
 *   resolution, so the job should be requeued rather than failed.
 * - `extract` means at least one resolved person can receive suggested memories
 *   now, even if other mentions in the same record remain unresolved (partial
 *   extraction — facts tied to unresolved mentions wait, see PRD #2).
 */
export function decideExtraction(input: DecideExtractionInput): ExtractionDecision {
  if (input.sourceRecord.status !== "active") {
    return { action: "skip", reason: "source_record_not_active" };
  }

  if (
    !canExtractFromSourceRecord(input.sourceRecord, {
      directlyRequested: input.directlyRequested,
    })
  ) {
    return { action: "skip", reason: "restricted_content" };
  }

  if (input.resolvedPersonCount === 0) {
    return input.unresolvedMentionCount > 0
      ? { action: "delay", reason: "awaiting_mention_resolution" }
      : { action: "skip", reason: "no_linked_people" };
  }

  return { action: "extract" };
}
