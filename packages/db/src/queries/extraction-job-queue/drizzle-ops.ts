import { claimableExtractionJobStatuses, createExtractionJobSchema } from "@tendnote/domain";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "../../client";
import { type extractionJobs, sourceRecordPeople, sourceRecords } from "../../schema";
import type { UpdateJobFields } from "./in-memory-queue";

// Postgres-claimable states (ADR 0018): a job can be picked up when freshly queued or
// after a retryable failure. Shared with the in-memory queue via the domain constant so
// claim semantics stay identical across pipelines and adapters.
const CLAIMABLE_STATUSES = [...claimableExtractionJobStatuses];

/**
 * The `extraction_jobs` and `action_extraction_jobs` tables have an identical column shape
 * (ADR 0018, #183) but are nominally distinct Drizzle table types, so callers over the
 * action table pass it through this alias. It only reconciles the compile-time table type;
 * every query still runs against the concrete table object the caller supplies.
 */
export type ExtractionJobQueueTable = typeof extractionJobs;

function buildJobUpdate(input: UpdateJobFields) {
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (input.status !== undefined) {
    updates.status = input.status;
  }
  if (input.lastError !== undefined) {
    updates.lastError = input.lastError;
  }
  if (input.runAfter !== undefined) {
    updates.runAfter = input.runAfter;
  }
  if ("claimedAt" in input) {
    updates.claimedAt = input.claimedAt;
  }
  if ("completedAt" in input) {
    updates.completedAt = input.completedAt;
  }

  return updates;
}

/**
 * Drizzle-backed Postgres-owned extraction job queue: the create/find/get/claim/update and
 * FIFO claim-next plumbing shared verbatim by memory extraction and action extraction. The
 * two pipelines keep fully separate physical tables (ADR 0018, #183), so each store passes
 * its own table object; this shares only the mechanical job-lifecycle SQL, not job state.
 * `notFoundLabel` names the table in the update-miss error.
 */
export function createDrizzleExtractionJobQueueOps(
  table: ExtractionJobQueueTable,
  notFoundLabel: string,
) {
  return {
    // Source-record reads the async processor performs outside a single owner request —
    // identical for both pipelines, which load a record by id and derive owner scope from it.
    async getSourceRecordById(sourceRecordId: string) {
      const [sourceRecord] = await getDb()
        .select()
        .from(sourceRecords)
        .where(eq(sourceRecords.id, sourceRecordId))
        .limit(1);

      return sourceRecord ?? null;
    },
    async listSourceRecordPeople(input: { sourceRecordId: string }) {
      return getDb()
        .select()
        .from(sourceRecordPeople)
        .where(eq(sourceRecordPeople.sourceRecordId, input.sourceRecordId))
        .orderBy(asc(sourceRecordPeople.createdAt));
    },
    async createJob(values: Parameters<typeof createExtractionJobSchema.parse>[0]) {
      const [job] = await getDb()
        .insert(table)
        .values(createExtractionJobSchema.parse(values))
        .returning();

      if (!job) {
        throw new Error(`Failed to create ${notFoundLabel.toLowerCase()}.`);
      }

      return job;
    },
    async findJobByIdempotencyKey(idempotencyKey: string) {
      const [job] = await getDb()
        .select()
        .from(table)
        .where(eq(table.idempotencyKey, idempotencyKey))
        .limit(1);

      return job ?? null;
    },
    async getJob(jobId: string) {
      const [job] = await getDb().select().from(table).where(eq(table.id, jobId)).limit(1);

      return job ?? null;
    },
    async claimJob(input: { jobId: string; now: Date }) {
      const [job] = await getDb()
        .update(table)
        .set({
          status: "running",
          claimedAt: input.now,
          attempts: sql`${table.attempts} + 1`,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(table.id, input.jobId),
            inArray(table.status, CLAIMABLE_STATUSES),
            lte(table.runAfter, input.now),
          ),
        )
        .returning();

      return job ?? null;
    },
    async claimNextJob(input: { now: Date }) {
      // Lock the next due job and skip rows other workers already hold, so the
      // Postgres-owned queue stays safe under concurrent pollers.
      const nextJob = getDb()
        .select({ id: table.id })
        .from(table)
        .where(and(inArray(table.status, CLAIMABLE_STATUSES), lte(table.runAfter, input.now)))
        .orderBy(asc(table.runAfter))
        .limit(1)
        .for("update", { skipLocked: true });

      const [job] = await getDb()
        .update(table)
        .set({
          status: "running",
          claimedAt: input.now,
          attempts: sql`${table.attempts} + 1`,
          updatedAt: input.now,
        })
        .where(inArray(table.id, nextJob))
        .returning();

      return job ?? null;
    },
    async updateJob(input: UpdateJobFields) {
      const [job] = await getDb()
        .update(table)
        .set(buildJobUpdate(input))
        .where(eq(table.id, input.jobId))
        .returning();

      if (!job) {
        throw new Error(`${notFoundLabel} not found.`);
      }

      return job;
    },
  };
}
