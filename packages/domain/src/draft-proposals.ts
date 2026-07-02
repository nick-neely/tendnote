import { z } from "zod";
import {
  draftSourceRefSchema,
  messageDraftChannelSchema,
  messageDraftPurposeSchema,
} from "./drafts";

export const draftProposalVariantSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  toneInstruction: z.string().min(1),
  body: z.string().min(1),
});
export type DraftProposalVariant = z.infer<typeof draftProposalVariantSchema>;

export const draftProposalSchema = z.object({
  id: z.string().min(1),
  ownerUserId: z.string(),
  personId: z.string(),
  personDisplayName: z.string(),
  channel: messageDraftChannelSchema,
  purpose: messageDraftPurposeSchema,
  variants: z.array(draftProposalVariantSchema).min(1),
  sourceRefs: z.array(draftSourceRefSchema).min(1),
  ephemeral: z.literal(true),
  persistenceRequiresExplicitOwnerIntent: z.literal(true),
});
export type DraftProposal = z.infer<typeof draftProposalSchema>;

export const draftProposalResultSchema = z.object({
  ownerUserId: z.string(),
  proposal: draftProposalSchema.nullable(),
  skippedReason: z
    .enum(["person_not_found", "insufficient_context", "generation_failed"])
    .nullish(),
  component: z.object({
    type: z.literal("draft_proposal"),
    proposalId: z.string().nullish(),
  }),
});
export type DraftProposalResult = z.infer<typeof draftProposalResultSchema>;
