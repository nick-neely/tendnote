import { randomUUID } from "node:crypto";
import {
  type ContextFactExtractionJob,
  type CreateContextFactExtractionJobInput,
  claimableContextFactExtractionJobStatuses,
  contextFactExtractionJobSchema,
  createContextFactExtractionJobSchema,
  pendingContextFactExtractionJobStatuses,
} from "@tendnote/domain";
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { getDb } from "../../client";
import { contextFactExtractionJobs } from "../../schema";
import { createDrizzleContextFactStore } from "../context-facts/drizzle-store";
import type { ContextFactExtractionJobStore } from "./types";
import { contextFactExtractionJobUpdateValues } from "./update-values";

const CLAIMABLE_STATUSES = [...claimableContextFactExtractionJobStatuses];
const PENDING_STATUSES = [...pendingContextFactExtractionJobStatuses];
const CONTEXT_FACT_EXTRACTION_JOB_LEASE_MS = 10 * 60 * 1000;

function claimableWhere(now: Date) {
  const staleBefore = new Date(now.getTime() - CONTEXT_FACT_EXTRACTION_JOB_LEASE_MS);
  return and(
    or(
      inArray(contextFactExtractionJobs.status, CLAIMABLE_STATUSES),
      and(
        eq(contextFactExtractionJobs.status, "running"),
        or(
          isNull(contextFactExtractionJobs.claimedAt),
          lt(contextFactExtractionJobs.claimedAt, staleBefore),
        ),
      ),
    ),
    lte(contextFactExtractionJobs.runAfter, now),
  );
}

function fromRow(row: typeof contextFactExtractionJobs.$inferSelect): ContextFactExtractionJob {
  return contextFactExtractionJobSchema.parse(row);
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
          claimToken: randomUUID(),
          attempts: sql`${contextFactExtractionJobs.attempts} + 1`,
          updatedAt: input.now,
        })
        .where(and(eq(contextFactExtractionJobs.id, input.jobId), claimableWhere(input.now)))
        .returning();
      return row ? fromRow(row) : null;
    },
    async claimNextContextFactExtractionJob(input) {
      const nextJob = getDb()
        .select({ id: contextFactExtractionJobs.id })
        .from(contextFactExtractionJobs)
        .where(and(claimableWhere(input.now)))
        .orderBy(asc(contextFactExtractionJobs.runAfter))
        .limit(1)
        .for("update", { skipLocked: true });
      const [row] = await getDb()
        .update(contextFactExtractionJobs)
        .set({
          status: "running",
          claimedAt: input.now,
          claimToken: randomUUID(),
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
        .set(contextFactExtractionJobUpdateValues(input))
        .where(
          and(
            eq(contextFactExtractionJobs.id, input.jobId),
            input.expectedClaimToken
              ? eq(contextFactExtractionJobs.claimToken, input.expectedClaimToken)
              : undefined,
          ),
        )
        .returning();
      return row ? fromRow(row) : null;
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
