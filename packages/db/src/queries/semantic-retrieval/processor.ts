import { createHash } from "node:crypto";
import {
  claimableEmbeddingJobStatuses,
  createEmbeddingJobSchema,
  createRelationshipContextEmbeddingSchema,
  decideApprovedMemoryEmbedding,
  type Memory,
  projectApprovedMemoryEmbeddedText,
  type SemanticRecordKind,
} from "@tendnote/domain";
import type {
  EmbeddingAdapter,
  EmbeddingConfig,
  EmbeddingStore,
  EnqueueEmbeddingJobInput,
  EnqueueEmbeddingJobResult,
  ProcessEmbeddingJobInput,
  ProcessEmbeddingJobResult,
} from "./types";

export const DEFAULT_EMBEDDING_RETRY_DELAY_MS = 5 * 60 * 1000;
export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  model: "fake-semantic-retrieval",
  version: "v1",
};

const CLAIMABLE_STATUSES = new Set(claimableEmbeddingJobStatuses);

function isClaimableStatus(status: ProcessEmbeddingJobResult["job"]["status"]) {
  return CLAIMABLE_STATUSES.has(status as (typeof claimableEmbeddingJobStatuses)[number]);
}

function idempotencyKeyFor(input: {
  ownerUserId: string;
  recordKind: SemanticRecordKind;
  recordId: string;
  config: EmbeddingConfig;
}) {
  return [
    "relationship_context_embedding",
    input.ownerUserId,
    input.recordKind,
    input.recordId,
    input.config.model,
    input.config.version,
  ].join(":");
}

export function fingerprintEmbeddedText(input: {
  recordKind: SemanticRecordKind;
  recordId: string;
  embeddedText: string;
}) {
  return createHash("sha256")
    .update(input.recordKind)
    .update("\0")
    .update(input.recordId)
    .update("\0")
    .update(input.embeddedText)
    .digest("hex");
}

export function createEmbeddingProcessor(
  store: EmbeddingStore,
  adapter: EmbeddingAdapter,
  config: EmbeddingConfig = DEFAULT_EMBEDDING_CONFIG,
) {
  async function failJob(
    job: ProcessEmbeddingJobResult["job"],
    message: string,
    now: Date,
    retryDelayMs: number,
  ): Promise<ProcessEmbeddingJobResult> {
    const updated = await store.updateEmbeddingJob({
      jobId: job.id,
      status: "failed",
      lastError: message,
      runAfter: new Date(now.getTime() + retryDelayMs),
      claimedAt: null,
    });

    await store.createAuditLogEntry({
      ownerUserId: job.ownerUserId,
      action: "embedding_job.failed",
      entityType: "relationship_context_embedding_job",
      entityId: job.id,
      metadataJson: {
        recordKind: job.recordKind,
        recordId: job.recordId,
        error: message,
      },
    });

    return { job: updated, outcome: "failed", embedding: null, error: message };
  }

  async function skipJob(
    job: ProcessEmbeddingJobResult["job"],
    reason: string,
    now: Date,
    sourceMemory: Memory | null = null,
  ): Promise<ProcessEmbeddingJobResult> {
    const updated = await store.updateEmbeddingJob({
      jobId: job.id,
      status: "skipped",
      completedAt: now,
    });

    await store.createAuditLogEntry({
      ownerUserId: job.ownerUserId,
      action: "embedding_job.skipped",
      entityType: "relationship_context_embedding_job",
      entityId: job.id,
      metadataJson: {
        recordKind: job.recordKind,
        recordId: job.recordId,
        reason,
      },
    });

    return { job: updated, outcome: "skipped", embedding: null, sourceMemory, reason };
  }

  async function processApprovedMemory(
    job: ProcessEmbeddingJobResult["job"],
  ): Promise<
    | Omit<ProcessEmbeddingJobResult, "job" | "outcome">
    | { skipReason: string; sourceMemory: Memory | null }
  > {
    const memory = await store.getMemory({
      ownerUserId: job.ownerUserId,
      memoryId: job.recordId,
    });

    if (!memory) {
      return { skipReason: "memory_not_found", sourceMemory: null };
    }

    const decision = decideApprovedMemoryEmbedding(memory);

    if (decision.action === "skip") {
      return { skipReason: decision.reason, sourceMemory: memory };
    }

    const embeddedText = projectApprovedMemoryEmbeddedText(memory);
    const contentFingerprint = fingerprintEmbeddedText({
      recordKind: "memory",
      recordId: memory.id,
      embeddedText,
    });

    const existing = await store.findRelationshipContextEmbedding({
      ownerUserId: memory.ownerUserId,
      recordKind: "memory",
      recordId: memory.id,
      embeddingModel: config.model,
      embeddingVersion: config.version,
    });

    if (existing?.contentFingerprint === contentFingerprint) {
      return { embedding: existing, sourceMemory: memory };
    }

    const adapterResult = await adapter.embedText({
      text: embeddedText,
      model: config.model,
      version: config.version,
    });

    const embedding = await store.upsertRelationshipContextEmbedding(
      createRelationshipContextEmbeddingSchema.parse({
        ownerUserId: memory.ownerUserId,
        personId: memory.personId,
        recordKind: "memory",
        recordId: memory.id,
        embedding: adapterResult.vector,
        embeddingModel: adapterResult.model,
        embeddingVersion: adapterResult.version,
        embeddingDimensions: adapterResult.vector.length,
        embeddedText,
        contentFingerprint,
        trustLevel: "confirmed_fact",
        sensitivity: memory.sensitivity,
        sourceUpdatedAt: memory.updatedAt,
      }),
    );

    return { embedding, sourceMemory: memory };
  }

  return {
    async enqueueEmbeddingJob(input: EnqueueEmbeddingJobInput): Promise<EnqueueEmbeddingJobResult> {
      const parsed = createEmbeddingJobSchema.parse({
        ownerUserId: input.ownerUserId,
        recordKind: input.recordKind,
        recordId: input.recordId,
        status: "pending",
        attempts: 0,
        lastError: null,
        idempotencyKey: idempotencyKeyFor({ ...input, config }),
        runAfter: input.runAfter ?? new Date(),
      });
      const existing = await store.findEmbeddingJobByIdempotencyKey(parsed.idempotencyKey);

      if (existing) {
        if (existing.status === "completed") {
          const job = await store.updateEmbeddingJob({
            jobId: existing.id,
            status: "pending",
            lastError: null,
            runAfter: input.runAfter ?? new Date(),
            claimedAt: null,
            completedAt: null,
          });

          return { job, created: false };
        }

        return { job: existing, created: false };
      }

      const job = await store.createEmbeddingJob(parsed);

      await store.createAuditLogEntry({
        ownerUserId: job.ownerUserId,
        action: "embedding_job.enqueue",
        entityType: "relationship_context_embedding_job",
        entityId: job.id,
        metadataJson: { recordKind: job.recordKind, recordId: job.recordId },
      });

      return { job, created: true };
    },

    async claimNextEmbeddingJob(input: { now?: Date } = {}) {
      return store.claimNextEmbeddingJob({ now: input.now ?? new Date() });
    },

    async processEmbeddingJob(input: ProcessEmbeddingJobInput): Promise<ProcessEmbeddingJobResult> {
      const now = input.now ?? new Date();
      const retryDelayMs = input.retryDelayMs ?? DEFAULT_EMBEDDING_RETRY_DELAY_MS;
      const claim = input.claim ?? true;
      const existingJob = await store.getEmbeddingJob(input.jobId);

      if (!existingJob) {
        throw new Error("Embedding job not found.");
      }

      let job = existingJob;

      if (job.status !== "running") {
        if (!claim || !isClaimableStatus(job.status)) {
          return { job, outcome: "not_claimable", embedding: null };
        }

        const claimed = await store.claimEmbeddingJob({ jobId: job.id, now });

        if (!claimed) {
          return { job, outcome: "not_claimable", embedding: null };
        }

        job = claimed;
      }

      try {
        const result =
          job.recordKind === "memory"
            ? await processApprovedMemory(job)
            : { skipReason: "source_record_not_eligible", sourceMemory: null };

        if ("skipReason" in result) {
          return skipJob(job, result.skipReason, now, result.sourceMemory);
        }

        if (!result.embedding) {
          return failJob(job, "Embedding was not created.", now, retryDelayMs);
        }

        const updated = await store.updateEmbeddingJob({
          jobId: job.id,
          status: "completed",
          completedAt: now,
          lastError: null,
        });

        await store.createAuditLogEntry({
          ownerUserId: job.ownerUserId,
          action: "embedding_job.completed",
          entityType: "relationship_context_embedding_job",
          entityId: job.id,
          metadataJson: {
            recordKind: job.recordKind,
            recordId: job.recordId,
            embeddingId: result.embedding.id,
          },
        });

        return {
          job: updated,
          outcome: "completed",
          embedding: result.embedding,
          sourceMemory: result.sourceMemory,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failJob(job, message, now, retryDelayMs);
      }
    },
  };
}
