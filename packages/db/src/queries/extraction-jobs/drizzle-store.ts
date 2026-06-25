import { claimableExtractionJobStatuses, createExtractionJobSchema } from "@tendnote/domain";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "../../client";
import {
  extractionJobs,
  sourceRecordPeople,
  sourceRecords,
  unresolvedPersonMentions,
} from "../../schema";
import { createDrizzleMemoryStore } from "../memories/drizzle-store";
import type { ExtractionJobStore, UpdateExtractionJobInput } from "./types";

// Postgres-claimable states (ADR 0018): a job can be picked up when freshly
// queued or after a retryable failure. Shared with the in-memory store via the
// domain constant so claim semantics stay identical across adapters.
const CLAIMABLE_STATUSES = [...claimableExtractionJobStatuses];

function buildJobUpdate(input: UpdateExtractionJobInput) {
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

export function createDrizzleExtractionJobStore(): ExtractionJobStore {
  const base = createDrizzleMemoryStore();

  return {
    ...base,
    async getSourceRecordById(sourceRecordId) {
      const [sourceRecord] = await getDb()
        .select()
        .from(sourceRecords)
        .where(eq(sourceRecords.id, sourceRecordId))
        .limit(1);

      return sourceRecord ?? null;
    },
    async listSourceRecordPeople(input) {
      return getDb()
        .select()
        .from(sourceRecordPeople)
        .where(eq(sourceRecordPeople.sourceRecordId, input.sourceRecordId))
        .orderBy(asc(sourceRecordPeople.createdAt));
    },
    async listUnresolvedMentions(input) {
      return getDb()
        .select()
        .from(unresolvedPersonMentions)
        .where(eq(unresolvedPersonMentions.sourceRecordId, input.sourceRecordId))
        .orderBy(asc(unresolvedPersonMentions.createdAt));
    },
    async createExtractionJob(values) {
      const [job] = await getDb()
        .insert(extractionJobs)
        .values(createExtractionJobSchema.parse(values))
        .returning();

      if (!job) {
        throw new Error("Failed to create extraction job.");
      }

      return job;
    },
    async findExtractionJobByIdempotencyKey(idempotencyKey) {
      const [job] = await getDb()
        .select()
        .from(extractionJobs)
        .where(eq(extractionJobs.idempotencyKey, idempotencyKey))
        .limit(1);

      return job ?? null;
    },
    async getExtractionJob(jobId) {
      const [job] = await getDb()
        .select()
        .from(extractionJobs)
        .where(eq(extractionJobs.id, jobId))
        .limit(1);

      return job ?? null;
    },
    async claimExtractionJob(input) {
      const [job] = await getDb()
        .update(extractionJobs)
        .set({
          status: "running",
          claimedAt: input.now,
          attempts: sql`${extractionJobs.attempts} + 1`,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(extractionJobs.id, input.jobId),
            inArray(extractionJobs.status, CLAIMABLE_STATUSES),
            lte(extractionJobs.runAfter, input.now),
          ),
        )
        .returning();

      return job ?? null;
    },
    async claimNextExtractionJob(input) {
      // Lock the next due job and skip rows other workers already hold, so the
      // Postgres-owned queue stays safe under concurrent pollers.
      const nextJob = getDb()
        .select({ id: extractionJobs.id })
        .from(extractionJobs)
        .where(
          and(
            inArray(extractionJobs.status, CLAIMABLE_STATUSES),
            lte(extractionJobs.runAfter, input.now),
          ),
        )
        .orderBy(asc(extractionJobs.runAfter))
        .limit(1)
        .for("update", { skipLocked: true });

      const [job] = await getDb()
        .update(extractionJobs)
        .set({
          status: "running",
          claimedAt: input.now,
          attempts: sql`${extractionJobs.attempts} + 1`,
          updatedAt: input.now,
        })
        .where(inArray(extractionJobs.id, nextJob))
        .returning();

      return job ?? null;
    },
    async updateExtractionJob(input) {
      const [job] = await getDb()
        .update(extractionJobs)
        .set(buildJobUpdate(input))
        .where(eq(extractionJobs.id, input.jobId))
        .returning();

      if (!job) {
        throw new Error("Extraction job not found.");
      }

      return job;
    },
  };
}
