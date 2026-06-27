import { randomUUID } from "node:crypto";
import {
  claimableEmbeddingJobStatuses,
  createEmbeddingJobSchema,
  createRelationshipContextEmbeddingSchema,
  type EmbeddingJob,
  type RelationshipContextEmbedding,
} from "@tendnote/domain";
import { createInMemoryMemoryStore } from "../memories/in-memory-store";
import type { InMemoryEmbeddingStore } from "./types";

const CLAIMABLE_STATUSES = new Set<EmbeddingJob["status"]>(claimableEmbeddingJobStatuses);

export function createInMemoryEmbeddingStore(): InMemoryEmbeddingStore {
  const base = createInMemoryMemoryStore();
  const jobs = new Map<string, EmbeddingJob>();
  const embeddings = new Map<string, RelationshipContextEmbedding>();

  function embeddingKey(
    embedding: Pick<
      RelationshipContextEmbedding,
      "ownerUserId" | "recordKind" | "recordId" | "embeddingModel" | "embeddingVersion"
    >,
  ) {
    return [
      embedding.ownerUserId,
      embedding.recordKind,
      embedding.recordId,
      embedding.embeddingModel,
      embedding.embeddingVersion,
    ].join(":");
  }

  function claim(job: EmbeddingJob, now: Date): EmbeddingJob {
    const claimed: EmbeddingJob = {
      ...job,
      status: "running",
      attempts: job.attempts + 1,
      claimedAt: now,
      updatedAt: now,
    };

    jobs.set(claimed.id, claimed);

    return claimed;
  }

  return {
    ...base,
    async listSourceRecordPeople(input) {
      const sourceRecord = await base.getSourceRecord({
        ownerUserId: input.ownerUserId,
        sourceRecordId: input.sourceRecordId,
      });

      return sourceRecord ? base.listSourceRecordPeople(input) : [];
    },
    async listUnresolvedMentions(input) {
      const sourceRecord = await base.getSourceRecord({
        ownerUserId: input.ownerUserId,
        sourceRecordId: input.sourceRecordId,
      });

      return sourceRecord ? base.listUnresolvedMentions(input) : [];
    },
    async createEmbeddingJob(values) {
      const parsed = createEmbeddingJobSchema.parse(values);
      const now = new Date();
      const job: EmbeddingJob = {
        ...parsed,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };

      jobs.set(job.id, job);

      return job;
    },
    async findEmbeddingJobByIdempotencyKey(idempotencyKey) {
      return [...jobs.values()].find((job) => job.idempotencyKey === idempotencyKey) ?? null;
    },
    async getEmbeddingJob(jobId) {
      return jobs.get(jobId) ?? null;
    },
    async claimEmbeddingJob(input) {
      const job = jobs.get(input.jobId);

      if (!job || !CLAIMABLE_STATUSES.has(job.status) || job.runAfter > input.now) {
        return null;
      }

      return claim(job, input.now);
    },
    async claimNextEmbeddingJob(input) {
      const next = [...jobs.values()]
        .filter((job) => CLAIMABLE_STATUSES.has(job.status) && job.runAfter <= input.now)
        .sort((a, b) => a.runAfter.getTime() - b.runAfter.getTime())[0];

      return next ? claim(next, input.now) : null;
    },
    async updateEmbeddingJob(input) {
      const job = jobs.get(input.jobId);

      if (!job) {
        throw new Error("Embedding job not found.");
      }

      const updated: EmbeddingJob = {
        ...job,
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
        ...(input.runAfter !== undefined ? { runAfter: input.runAfter } : {}),
        ...("claimedAt" in input ? { claimedAt: input.claimedAt } : {}),
        ...("completedAt" in input ? { completedAt: input.completedAt } : {}),
        updatedAt: new Date(),
      };

      jobs.set(updated.id, updated);

      return updated;
    },
    async upsertRelationshipContextEmbedding(values) {
      const parsed = createRelationshipContextEmbeddingSchema.parse(values);
      const existing = embeddings.get(embeddingKey(parsed));
      const now = new Date();
      const embedding: RelationshipContextEmbedding = {
        ...parsed,
        id: existing?.id ?? randomUUID(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      embeddings.set(embeddingKey(embedding), embedding);

      return embedding;
    },
    async findRelationshipContextEmbedding(input) {
      return embeddings.get(embeddingKey(input)) ?? null;
    },
    async listEmbeddingJobs() {
      return [...jobs.values()];
    },
    async listRelationshipContextEmbeddings() {
      return [...embeddings.values()];
    },
  };
}
