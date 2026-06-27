import {
  claimableEmbeddingJobStatuses,
  createEmbeddingJobSchema,
  createRelationshipContextEmbeddingSchema,
  type SemanticRetrievalResult,
} from "@tendnote/domain";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb } from "../../client";
import {
  relationshipContextEmbeddingJobs,
  relationshipContextEmbeddings,
  sourceRecordPeople,
  sourceRecords,
  unresolvedPersonMentions,
} from "../../schema";
import { createDrizzleMemoryStore } from "../memories/drizzle-store";
import type { EmbeddingStore, UpdateEmbeddingJobInput } from "./types";

const CLAIMABLE_STATUSES = [...claimableEmbeddingJobStatuses];

type SemanticMemorySearchRow = {
  record_kind: "memory";
  record_id: string;
  related_person_id: string | null;
  related_person_display_name: string | null;
  snippet: string;
  similarity: string | number;
  trust_level: "confirmed_fact" | "logged_context";
  sensitivity: "normal" | "sensitive" | "restricted";
};

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
    async listSourceRecordPeople(input) {
      const rows = await getDb()
        .select()
        .from(sourceRecordPeople)
        .innerJoin(sourceRecords, eq(sourceRecordPeople.sourceRecordId, sourceRecords.id))
        .where(
          and(
            eq(sourceRecordPeople.sourceRecordId, input.sourceRecordId),
            eq(sourceRecords.ownerUserId, input.ownerUserId),
          ),
        )
        .orderBy(asc(sourceRecordPeople.createdAt));

      return rows.map((row) => row.source_record_people);
    },
    async listUnresolvedMentions(input) {
      const rows = await getDb()
        .select()
        .from(unresolvedPersonMentions)
        .innerJoin(sourceRecords, eq(unresolvedPersonMentions.sourceRecordId, sourceRecords.id))
        .where(
          and(
            eq(unresolvedPersonMentions.sourceRecordId, input.sourceRecordId),
            eq(sourceRecords.ownerUserId, input.ownerUserId),
          ),
        )
        .orderBy(asc(unresolvedPersonMentions.createdAt));

      return rows.map((row) => row.unresolved_person_mentions);
    },
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
    async searchSemanticContext(input) {
      if (input.recordKinds && !input.recordKinds.includes("memory")) {
        return [];
      }

      const queryVector = `[${input.queryEmbedding.join(",")}]`;
      const rows = await getDb().execute(sql<SemanticMemorySearchRow>`
        select
          e.record_kind::text as record_kind,
          e.record_id::text as record_id,
          e.person_id::text as related_person_id,
          p.display_name as related_person_display_name,
          e.embedded_text as snippet,
          (1 - (e.embedding <=> ${queryVector}::vector))::float8 as similarity,
          e.trust_level::text as trust_level,
          e.sensitivity::text as sensitivity
        from relationship_context_embeddings e
        inner join memories m
          on m.id = e.record_id
          and e.record_kind = 'memory'
        inner join people p
          on p.id = m.person_id
          and p.owner_user_id = ${input.ownerUserId}
        where
          e.owner_user_id = ${input.ownerUserId}
          and m.owner_user_id = ${input.ownerUserId}
          and e.record_kind = 'memory'
          and m.status = 'approved'
          and e.embedding_model = ${input.embeddingModel}
          and e.embedding_version = ${input.embeddingVersion}
          and e.embedding_dimensions = ${input.queryEmbedding.length}
          and e.source_updated_at = m.updated_at
          and e.embedded_text = regexp_replace(btrim(m.content), '\\s+', ' ', 'g')
          and e.sensitivity = m.sensitivity
          and (${input.personId ? sql`e.person_id = ${input.personId}` : sql`true`})
          and (${input.directlyRequested}::boolean or e.sensitivity <> 'restricted')
          and (1 - (e.embedding <=> ${queryVector}::vector)) >= ${input.minimumSimilarity}
        order by
          similarity desc,
          m.importance desc,
          m.updated_at desc,
          e.record_id asc
        limit ${input.limit}
      `);

      return (rows as unknown as SemanticMemorySearchRow[]).map(toSemanticRetrievalResult);
    },
  };
}

function toSemanticRetrievalResult(row: SemanticMemorySearchRow): SemanticRetrievalResult {
  return {
    recordKind: row.record_kind,
    recordId: row.record_id,
    relatedPersonId: row.related_person_id,
    relatedPersonDisplayName: row.related_person_display_name,
    snippet: row.snippet,
    similarity: Number(row.similarity),
    trustLevel: row.trust_level,
    sensitivity: row.sensitivity,
    sourceRefs: [{ kind: row.record_kind, id: row.record_id }],
    routing: {
      personId: row.related_person_id,
      recordKind: row.record_kind,
      recordId: row.record_id,
    },
  };
}
