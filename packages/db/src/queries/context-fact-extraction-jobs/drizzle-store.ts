import {
  type ContextFactExtractionJob,
  type CreateContextFactExtractionJobInput,
  claimableContextFactExtractionJobStatuses,
  contextFactExtractionJobSchema,
  createContextFactExtractionJobSchema,
  pendingContextFactExtractionJobStatuses,
} from "@tendnote/domain";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "../../client";
import { contextFactExtractionJobs } from "../../schema";
import { createDrizzleContextFactStore } from "../context-facts/drizzle-store";
import type { ContextFactExtractionJobStore, UpdateContextFactExtractionJobInput } from "./types";

const CLAIMABLE_STATUSES = [...claimableContextFactExtractionJobStatuses];
const PENDING_STATUSES = [...pendingContextFactExtractionJobStatuses];

function fromRow(row: typeof contextFactExtractionJobs.$inferSelect): ContextFactExtractionJob {
  return contextFactExtractionJobSchema.parse(row);
}

function updateValues(input: UpdateContextFactExtractionJobInput) {
  return {
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
    ...(input.runAfter !== undefined ? { runAfter: input.runAfter } : {}),
    ...(Object.hasOwn(input, "claimedAt") ? { claimedAt: input.claimedAt } : {}),
    ...(Object.hasOwn(input, "completedAt") ? { completedAt: input.completedAt } : {}),
    updatedAt: new Date(),
  };
}

export function createDrizzleContextFactExtractionJobStore(): ContextFactExtractionJobStore {
  const base = createDrizzleContextFactStore();

  return {
    ...base,
    async createContextFactExtractionJob(input: CreateContextFactExtractionJobInput) {
      const parsed = createContextFactExtractionJobSchema.parse(input);
      const [row] = await getDb()
        .insert(contextFactExtractionJobs)
        .values(parsed)
        .onConflictDoNothing({ target: contextFactExtractionJobs.idempotencyKey })
        .returning();
      if (row) return fromRow(row);
      const existing = await this.findContextFactExtractionJobByIdempotencyKey(
        parsed.idempotencyKey,
      );
      if (existing) return existing;
      throw new Error("Failed to create Context Fact extraction job.");
    },
    async findContextFactExtractionJobByIdempotencyKey(idempotencyKey) {
      const [row] = await getDb()
        .select()
        .from(contextFactExtractionJobs)
        .where(eq(contextFactExtractionJobs.idempotencyKey, idempotencyKey))
        .limit(1);
      return row ? fromRow(row) : null;
    },
    async getContextFactExtractionJob(jobId) {
      const [row] = await getDb()
        .select()
        .from(contextFactExtractionJobs)
        .where(eq(contextFactExtractionJobs.id, jobId))
        .limit(1);
      return row ? fromRow(row) : null;
    },
    async claimContextFactExtractionJob(input) {
      const [row] = await getDb()
        .update(contextFactExtractionJobs)
        .set({
          status: "running",
          claimedAt: input.now,
          attempts: sql`${contextFactExtractionJobs.attempts} + 1`,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(contextFactExtractionJobs.id, input.jobId),
            inArray(contextFactExtractionJobs.status, CLAIMABLE_STATUSES),
            lte(contextFactExtractionJobs.runAfter, input.now),
          ),
        )
        .returning();
      return row ? fromRow(row) : null;
    },
    async claimNextContextFactExtractionJob(input) {
      const nextJob = getDb()
        .select({ id: contextFactExtractionJobs.id })
        .from(contextFactExtractionJobs)
        .where(
          and(
            inArray(contextFactExtractionJobs.status, CLAIMABLE_STATUSES),
            lte(contextFactExtractionJobs.runAfter, input.now),
          ),
        )
        .orderBy(asc(contextFactExtractionJobs.runAfter))
        .limit(1)
        .for("update", { skipLocked: true });
      const [row] = await getDb()
        .update(contextFactExtractionJobs)
        .set({
          status: "running",
          claimedAt: input.now,
          attempts: sql`${contextFactExtractionJobs.attempts} + 1`,
          updatedAt: input.now,
        })
        .where(inArray(contextFactExtractionJobs.id, nextJob))
        .returning();
      return row ? fromRow(row) : null;
    },
    async updateContextFactExtractionJob(input) {
      const [row] = await getDb()
        .update(contextFactExtractionJobs)
        .set(updateValues(input))
        .where(eq(contextFactExtractionJobs.id, input.jobId))
        .returning();
      if (!row) throw new Error("Context Fact extraction job not found.");
      return fromRow(row);
    },
    async countPendingContextFactExtractionJobs(input) {
      const [row] = await getDb()
        .select({ count: sql<number>`count(*)` })
        .from(contextFactExtractionJobs)
        .where(
          and(
            eq(contextFactExtractionJobs.ownerUserId, input.ownerUserId),
            inArray(contextFactExtractionJobs.status, PENDING_STATUSES),
          ),
        );
      return Number(row?.count ?? 0);
    },
  };
}
