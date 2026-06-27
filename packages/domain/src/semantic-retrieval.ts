import { z } from "zod";
import type { memoryStatusSchema } from "./memories";
import { sensitivitySchema } from "./privacy";
import type { sourceRecordStatusSchema } from "./source-records";

export const semanticRecordKindSchema = z.enum(["memory", "source_record"]);

export const semanticTrustLevelSchema = z.enum(["confirmed_fact", "logged_context"]);

export const embeddingJobStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);

export const relationshipContextEmbeddingSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  personId: z.string().nullable(),
  recordKind: semanticRecordKindSchema,
  recordId: z.string(),
  embedding: z.array(z.number()),
  embeddingModel: z.string().min(1),
  embeddingVersion: z.string().min(1),
  embeddingDimensions: z.number().int().positive(),
  embeddedText: z.string().min(1),
  contentFingerprint: z.string().min(1),
  trustLevel: semanticTrustLevelSchema,
  sensitivity: sensitivitySchema,
  sourceUpdatedAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createRelationshipContextEmbeddingSchema = relationshipContextEmbeddingSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const embeddingJobSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  recordKind: semanticRecordKindSchema,
  recordId: z.string(),
  status: embeddingJobStatusSchema.default("pending"),
  attempts: z.number().int().min(0).default(0),
  lastError: z.string().nullable().optional(),
  idempotencyKey: z.string().min(1),
  runAfter: z.date(),
  claimedAt: z.date().nullable().optional(),
  completedAt: z.date().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createEmbeddingJobSchema = embeddingJobSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type SemanticRecordKind = z.infer<typeof semanticRecordKindSchema>;
export type SemanticTrustLevel = z.infer<typeof semanticTrustLevelSchema>;
export type RelationshipContextEmbedding = z.infer<typeof relationshipContextEmbeddingSchema>;
export type CreateRelationshipContextEmbeddingInput = z.infer<
  typeof createRelationshipContextEmbeddingSchema
>;
export type EmbeddingJobStatus = z.infer<typeof embeddingJobStatusSchema>;
export type EmbeddingJob = z.infer<typeof embeddingJobSchema>;
export type CreateEmbeddingJobInput = z.infer<typeof createEmbeddingJobSchema>;

export const claimableEmbeddingJobStatuses = [
  "pending",
  "failed",
] as const satisfies ReadonlyArray<EmbeddingJobStatus>;

export type ApprovedMemoryEmbeddingSource = {
  id: string;
  ownerUserId: string;
  personId: string;
  content: string;
  status: z.infer<typeof memoryStatusSchema>;
  sensitivity: z.infer<typeof sensitivitySchema>;
  updatedAt: Date;
};

export type SourceRecordEmbeddingSource = {
  id: string;
  ownerUserId: string;
  status: z.infer<typeof sourceRecordStatusSchema>;
  sensitivity: z.infer<typeof sensitivitySchema>;
};

export type EmbeddingDecision =
  | { action: "embed" }
  | {
      action: "skip";
      reason:
        | "memory_not_approved"
        | "empty_embedded_text"
        | "source_record_not_eligible"
        | "restricted_content";
    };

export function decideApprovedMemoryEmbedding(
  memory: ApprovedMemoryEmbeddingSource,
): EmbeddingDecision {
  if (memory.status !== "approved") {
    return { action: "skip", reason: "memory_not_approved" };
  }

  if (memory.sensitivity === "restricted") {
    return { action: "skip", reason: "restricted_content" };
  }

  if (projectApprovedMemoryEmbeddedText(memory).length === 0) {
    return { action: "skip", reason: "empty_embedded_text" };
  }

  return { action: "embed" };
}

export function projectApprovedMemoryEmbeddedText(
  memory: Pick<ApprovedMemoryEmbeddingSource, "content">,
) {
  return memory.content.trim().replace(/\s+/g, " ");
}
