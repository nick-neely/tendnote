import {
  claimableEmbeddingJobStatuses,
  createEmbeddingJobSchema,
  createRelationshipContextEmbeddingSchema,
} from "@tendnote/domain";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "../../client";
import { relationshipContextEmbeddingJobs, relationshipContextEmbeddings } from "../../schema";
import { createDrizzleMemoryStore } from "../memories/drizzle-store";
import type { EmbeddingStore, UpdateEmbeddingJobInput } from "./types";

const CLAIMABLE_STATUSES = [...claimableEmbeddingJobStatuses];

function buildJobUpdate(input: UpdateEmbeddingJobInput) {
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (input.status !== undefined) updates.status = input.status;
  if (input.lastError !== undefined) updates.lastError = input.lastError;
  if (input.runAfter !== undefined) updates.runAfter = input.runAfter;
  if ("claimedAt" in input) updates.claimedAt = input.claimedAt;
  if ("completedAt" in input) updates.completedAt = input.completedAt;

  return updates;
}

export function createDrizzleEmbeddingStore(): EmbeddingStore {
  const base = createDrizzleMemoryStore();

  return {
    ...base,
    async createEmbeddingJob(values) {
      const [job] = await getDb()
        .insert(relationshipContextEmbeddingJobs)
        .values(createEmbeddingJobSchema.parse(values))
        .returning();

      if (!job) {
        throw new Error("Failed to create embedding job.");
      }

      return job;
    },
    async findEmbeddingJobByIdempotencyKey(idempotencyKey) {
      const [job] = await getDb()
        .select()
        .from(relationshipContextEmbeddingJobs)
        .where(eq(relationshipContextEmbeddingJobs.idempotencyKey, idempotencyKey))
        .limit(1);

      return job ?? null;
    },
    async getEmbeddingJob(jobId) {
      const [job] = await getDb()
        .select()
        .from(relationshipContextEmbeddingJobs)
        .where(eq(relationshipContextEmbeddingJobs.id, jobId))
        .limit(1);

      return job ?? null;
    },
    async claimEmbeddingJob(input) {
      const [job] = await getDb()
        .update(relationshipContextEmbeddingJobs)
        .set({
          status: "running",
          claimedAt: input.now,
          attempts: sql`${relationshipContextEmbeddingJobs.attempts} + 1`,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(relationshipContextEmbeddingJobs.id, input.jobId),
            inArray(relationshipContextEmbeddingJobs.status, CLAIMABLE_STATUSES),
            lte(relationshipContextEmbeddingJobs.runAfter, input.now),
          ),
        )
        .returning();

      return job ?? null;
    },
    async claimNextEmbeddingJob(input) {
      const nextJob = getDb()
        .select({ id: relationshipContextEmbeddingJobs.id })
        .from(relationshipContextEmbeddingJobs)
        .where(
          and(
            inArray(relationshipContextEmbeddingJobs.status, CLAIMABLE_STATUSES),
            lte(relationshipContextEmbeddingJobs.runAfter, input.now),
          ),
        )
        .orderBy(asc(relationshipContextEmbeddingJobs.runAfter))
        .limit(1)
        .for("update", { skipLocked: true });

      const [job] = await getDb()
        .update(relationshipContextEmbeddingJobs)
        .set({
          status: "running",
          claimedAt: input.now,
          attempts: sql`${relationshipContextEmbeddingJobs.attempts} + 1`,
          updatedAt: input.now,
        })
        .where(inArray(relationshipContextEmbeddingJobs.id, nextJob))
        .returning();

      return job ?? null;
    },
    async updateEmbeddingJob(input) {
      const [job] = await getDb()
        .update(relationshipContextEmbeddingJobs)
        .set(buildJobUpdate(input))
        .where(eq(relationshipContextEmbeddingJobs.id, input.jobId))
        .returning();

      if (!job) {
        throw new Error("Embedding job not found.");
      }

      return job;
    },
    async upsertRelationshipContextEmbedding(values) {
      const parsed = createRelationshipContextEmbeddingSchema.parse(values);
      const [embedding] = await getDb()
        .insert(relationshipContextEmbeddings)
        .values(parsed)
        .onConflictDoUpdate({
          target: [
            relationshipContextEmbeddings.ownerUserId,
            relationshipContextEmbeddings.recordKind,
            relationshipContextEmbeddings.recordId,
            relationshipContextEmbeddings.embeddingModel,
            relationshipContextEmbeddings.embeddingVersion,
          ],
          set: {
            personId: parsed.personId,
            embedding: parsed.embedding,
            embeddingDimensions: parsed.embeddingDimensions,
            embeddedText: parsed.embeddedText,
            contentFingerprint: parsed.contentFingerprint,
            trustLevel: parsed.trustLevel,
            sensitivity: parsed.sensitivity,
            sourceUpdatedAt: parsed.sourceUpdatedAt,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (!embedding) {
        throw new Error("Failed to upsert relationship-context embedding.");
      }

      return embedding;
    },
    async findRelationshipContextEmbedding(input) {
      const [embedding] = await getDb()
        .select()
        .from(relationshipContextEmbeddings)
        .where(
          and(
            eq(relationshipContextEmbeddings.ownerUserId, input.ownerUserId),
            eq(relationshipContextEmbeddings.recordKind, input.recordKind),
            eq(relationshipContextEmbeddings.recordId, input.recordId),
            eq(relationshipContextEmbeddings.embeddingModel, input.embeddingModel),
            eq(relationshipContextEmbeddings.embeddingVersion, input.embeddingVersion),
          ),
        )
        .limit(1);

      return embedding ?? null;
    },
  };
}
