import { randomUUID } from "node:crypto";
import {
  claimableEmbeddingJobStatuses,
  createEmbeddingJobSchema,
  createRelationshipContextEmbeddingSchema,
  decideSourceRecordEmbedding,
  type EmbeddingJob,
  projectApprovedMemoryEmbeddedText,
  projectSourceRecordEmbeddedText,
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
    async searchSemanticContext(input) {
      const kinds = new Set(input.recordKinds ?? ["memory", "source_record"]);
      const results = await Promise.all(
        [...embeddings.values()].map(async (embedding) => {
          if (embedding.ownerUserId !== input.ownerUserId) return null;
          if (!kinds.has(embedding.recordKind)) return null;
          if (embedding.embeddingModel !== input.embeddingModel) return null;
          if (embedding.embeddingVersion !== input.embeddingVersion) return null;
          if (embedding.embeddingDimensions !== input.queryEmbedding.length) return null;
          if (embedding.sensitivity === "restricted" && !input.directlyRequested) return null;

          if (embedding.recordKind === "source_record") {
            if (embedding.trustLevel !== "logged_context") return null;

            const sourceRecord = await base.getSourceRecord({
              ownerUserId: input.ownerUserId,
              sourceRecordId: embedding.recordId,
            });

            if (!sourceRecord) return null;

            const links = await base.listSourceRecordPeople({
              sourceRecordId: sourceRecord.id,
            });
            const people = (
              await Promise.all(
                links.map((link) =>
                  base.getPerson({ ownerUserId: input.ownerUserId, personId: link.personId }),
                ),
              )
            )
              .filter((person): person is NonNullable<typeof person> => Boolean(person))
              .map((person) => ({ id: person.id, displayName: person.displayName }));
            if (input.personId && !people.some((person) => person.id === input.personId)) {
              return null;
            }
            const unresolvedMentions = await base.listUnresolvedMentions({
              sourceRecordId: sourceRecord.id,
            });
            const unresolvedMentionCount = unresolvedMentions.filter(
              (mention) => mention.status === "unresolved",
            ).length;
            const decision = decideSourceRecordEmbedding(
              sourceRecord,
              people,
              unresolvedMentionCount,
            );

            if (decision.action === "skip") return null;
            if (sourceRecord.sensitivity !== embedding.sensitivity) return null;
            if (projectSourceRecordEmbeddedText(sourceRecord, people) !== embedding.embeddedText) {
              return null;
            }
            if (sourceRecord.updatedAt.getTime() !== embedding.sourceUpdatedAt.getTime()) {
              return null;
            }

            const similarity = cosineSimilarity(input.queryEmbedding, embedding.embedding);

            if (similarity < input.minimumSimilarity) return null;

            const resultPersonId = input.personId ?? embedding.personId;
            const person = resultPersonId
              ? await base.getPerson({
                  ownerUserId: input.ownerUserId,
                  personId: resultPersonId,
                })
              : null;

            return {
              recordKind: "source_record" as const,
              recordId: embedding.recordId,
              relatedPersonId: resultPersonId,
              relatedPersonDisplayName: person?.displayName ?? null,
              snippet: embedding.embeddedText,
              similarity,
              trustLevel: embedding.trustLevel,
              sensitivity: embedding.sensitivity,
              sourceRefs: [{ kind: "source_record" as const, id: embedding.recordId }],
              routing: {
                personId: resultPersonId,
                recordKind: "source_record" as const,
                recordId: embedding.recordId,
              },
              tieBreakers: {
                importance: sourceRecord.importance,
                updatedAt: sourceRecord.updatedAt,
              },
            };
          }

          if (input.personId && embedding.personId !== input.personId) return null;
          if (embedding.trustLevel !== "confirmed_fact") return null;

          const memory = await base.getMemory({
            ownerUserId: input.ownerUserId,
            memoryId: embedding.recordId,
          });

          if (memory?.status !== "approved") return null;
          if (memory.sensitivity === "restricted" && !input.directlyRequested) return null;
          if (memory.sensitivity !== embedding.sensitivity) return null;
          if (projectApprovedMemoryEmbeddedText(memory) !== embedding.embeddedText) return null;
          if (memory.updatedAt.getTime() !== embedding.sourceUpdatedAt.getTime()) return null;

          const similarity = cosineSimilarity(input.queryEmbedding, embedding.embedding);

          if (similarity < input.minimumSimilarity) return null;

          const person = embedding.personId
            ? await base.getPerson({ ownerUserId: input.ownerUserId, personId: embedding.personId })
            : null;

          return {
            recordKind: "memory" as const,
            recordId: embedding.recordId,
            relatedPersonId: embedding.personId,
            relatedPersonDisplayName: person?.displayName ?? null,
            snippet: embedding.embeddedText,
            similarity,
            trustLevel: embedding.trustLevel,
            sensitivity: embedding.sensitivity,
            sourceRefs: [{ kind: "memory" as const, id: embedding.recordId }],
            routing: {
              personId: embedding.personId,
              recordKind: "memory" as const,
              recordId: embedding.recordId,
            },
            tieBreakers: {
              importance: memory.importance,
              updatedAt: memory.updatedAt,
            },
          };
        }),
      );

      return results
        .filter((result): result is NonNullable<typeof result> => Boolean(result))
        .sort(compareSemanticResults)
        .slice(0, input.limit)
        .map(({ tieBreakers: _tieBreakers, ...result }) => result);
    },
    async listEmbeddingJobs() {
      return [...jobs.values()];
    },
    async listRelationshipContextEmbeddings() {
      return [...embeddings.values()];
    },
  };
}

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }

  const dot = left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
  const leftMagnitude = Math.hypot(...left);
  const rightMagnitude = Math.hypot(...right);

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (leftMagnitude * rightMagnitude);
}

type InMemorySemanticResult = Awaited<
  ReturnType<InMemoryEmbeddingStore["searchSemanticContext"]>
>[number] & {
  tieBreakers: {
    importance: number;
    updatedAt: Date;
  };
};

function compareSemanticResults(left: InMemorySemanticResult, right: InMemorySemanticResult) {
  const similarityBucketDelta =
    similarityBucket(right.similarity) - similarityBucket(left.similarity);
  if (similarityBucketDelta !== 0) return similarityBucketDelta;

  return (
    right.tieBreakers.importance - left.tieBreakers.importance ||
    right.tieBreakers.updatedAt.getTime() - left.tieBreakers.updatedAt.getTime() ||
    left.recordId.localeCompare(right.recordId)
  );
}

function similarityBucket(similarity: number) {
  return Math.round(similarity * 10_000);
}
