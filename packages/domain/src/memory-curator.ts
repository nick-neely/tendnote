import { z } from "zod";
import { sensitivitySchema } from "./privacy";

export const memoryCuratorProposalKindSchema = z.enum([
  "duplicate_memory",
  "stale_memory_archive",
  "contradiction_warning",
  "rewrite_suggestion",
  "clarification_prompt",
  "source_record_cleanup",
]);
export type MemoryCuratorProposalKind = z.infer<typeof memoryCuratorProposalKindSchema>;

export const memoryCuratorSourceRefSchema = z.object({
  kind: z.enum(["memory", "source_record"]),
  id: z.string(),
  label: z.string(),
});
export type MemoryCuratorSourceRef = z.infer<typeof memoryCuratorSourceRefSchema>;

export const memoryCuratorProposalSchema = z.object({
  id: z.string(),
  kind: memoryCuratorProposalKindSchema,
  ownerUserId: z.string(),
  personId: z.string().nullable().default(null),
  personDisplayName: z.string().nullable().default(null),
  title: z.string().min(1),
  reason: z.string().min(1),
  suggestedAction: z.string().min(1),
  sourceRefs: z.array(memoryCuratorSourceRefSchema).min(1),
  sensitivity: sensitivitySchema,
  reviewOnly: z.literal(true),
});
export type MemoryCuratorProposal = z.infer<typeof memoryCuratorProposalSchema>;

export const memoryCuratorProposalResultSchema = z.object({
  ownerUserId: z.string(),
  proposals: z.array(memoryCuratorProposalSchema),
  component: z.object({
    type: z.literal("memory_curator_proposals"),
    proposalCount: z.number().int().nonnegative(),
  }),
});
export type MemoryCuratorProposalResult = z.infer<typeof memoryCuratorProposalResultSchema>;
