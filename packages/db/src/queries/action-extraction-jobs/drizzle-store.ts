import {
  claimableExtractionJobStatuses,
  createExtractionJobSchema,
  generalActionSchema,
} from "@tendnote/domain";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "../../client";
import {
  actionExtractionJobs,
  generalActions,
  sourceRecordPeople,
  sourceRecords,
} from "../../schema";
import { createDrizzleGeneralActionAreaStore } from "../general-action-areas/drizzle-store";
import { createDrizzleGeneralActionLifecycleStore } from "../general-actions/drizzle-store";
import type { ActionExtractionJobStore, UpdateActionExtractionJobInput } from "./types";

// Postgres-claimable states (ADR 0018), shared with memory extraction and the in-memory
// store so claim semantics stay identical across pipelines and adapters.
const CLAIMABLE_STATUSES = [...claimableExtractionJobStatuses];

function buildJobUpdate(input: UpdateActionExtractionJobInput) {
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
 * Drizzle-backed action extraction store: the General Action lifecycle store (so
 * proposals go through the real review seam, scope, and history) plus the system-level
 * reads the async processor needs and the Postgres-owned action-job lifecycle over the
 * separate `action_extraction_jobs` table. Like memory extraction, it loads a source
 * record by id and derives owner scope from the loaded record rather than trusting a
 * caller-supplied owner id.
 */
export function createDrizzleActionExtractionJobStore(): ActionExtractionJobStore {
  const base = createDrizzleGeneralActionLifecycleStore();
  const areas = createDrizzleGeneralActionAreaStore();

  return {
    ...base,
    listAreasForOwner: areas.listAreasForOwner,
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
    async listGeneralActionsForSourceRecord(input) {
      const rows = await getDb()
        .select()
        .from(generalActions)
        .where(
          and(
            eq(generalActions.ownerUserId, input.ownerUserId),
            eq(generalActions.sourceRecordId, input.sourceRecordId),
          ),
        );

      return rows.map((row) => generalActionSchema.parse(row));
    },
    async createActionExtractionJob(values) {
      const [job] = await getDb()
        .insert(actionExtractionJobs)
        .values(createExtractionJobSchema.parse(values))
        .returning();

      if (!job) {
        throw new Error("Failed to create action extraction job.");
      }

      return job;
    },
    async findActionExtractionJobByIdempotencyKey(idempotencyKey) {
      const [job] = await getDb()
        .select()
        .from(actionExtractionJobs)
        .where(eq(actionExtractionJobs.idempotencyKey, idempotencyKey))
        .limit(1);

      return job ?? null;
    },
    async getActionExtractionJob(jobId) {
      const [job] = await getDb()
        .select()
        .from(actionExtractionJobs)
        .where(eq(actionExtractionJobs.id, jobId))
        .limit(1);

      return job ?? null;
    },
    async claimActionExtractionJob(input) {
      const [job] = await getDb()
        .update(actionExtractionJobs)
        .set({
          status: "running",
          claimedAt: input.now,
          attempts: sql`${actionExtractionJobs.attempts} + 1`,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(actionExtractionJobs.id, input.jobId),
            inArray(actionExtractionJobs.status, CLAIMABLE_STATUSES),
            lte(actionExtractionJobs.runAfter, input.now),
          ),
        )
        .returning();

      return job ?? null;
    },
    async claimNextActionExtractionJob(input) {
      // Lock the next due job and skip rows other workers already hold, so the
      // Postgres-owned queue stays safe under concurrent pollers.
      const nextJob = getDb()
        .select({ id: actionExtractionJobs.id })
        .from(actionExtractionJobs)
        .where(
          and(
            inArray(actionExtractionJobs.status, CLAIMABLE_STATUSES),
            lte(actionExtractionJobs.runAfter, input.now),
          ),
        )
        .orderBy(asc(actionExtractionJobs.runAfter))
        .limit(1)
        .for("update", { skipLocked: true });

      const [job] = await getDb()
        .update(actionExtractionJobs)
        .set({
          status: "running",
          claimedAt: input.now,
          attempts: sql`${actionExtractionJobs.attempts} + 1`,
          updatedAt: input.now,
        })
        .where(inArray(actionExtractionJobs.id, nextJob))
        .returning();

      return job ?? null;
    },
    async updateActionExtractionJob(input) {
      const [job] = await getDb()
        .update(actionExtractionJobs)
        .set(buildJobUpdate(input))
        .where(eq(actionExtractionJobs.id, input.jobId))
        .returning();

      if (!job) {
        throw new Error("Action extraction job not found.");
      }

      return job;
    },
  };
}
