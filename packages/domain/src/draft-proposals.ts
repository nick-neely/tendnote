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
  /**
   * A hash over this variant's body and the proposal's source references, stamped
   * by the generator that produced them.
   *
   * A Draft Proposal is ephemeral - nothing about it is stored - so accepting one
   * used to mean handing the wording and the provenance back through the model and
   * writing whatever arrived. The digest makes the persist step check that what it
   * is writing is what was proposed: it recomputes this over the body and refs it
   * was given and refuses a mismatch, so an edited body cannot be persisted under a
   * proposal's identity or its `accepted_proposal` audit entry.
   *
   * It binds content, not authority: a digest proves the wording was issued, and
   * the owner approval on `create_message_draft` is what proves they accepted it.
   * Optional because a proposal rendered before this field existed still parses.
   */
  digest: z.string().min(1).optional(),
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
