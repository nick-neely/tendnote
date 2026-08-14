import { proposeDraft } from "@tendnote/db/queries/draft-proposals";
import { messageDraftChannelSchema, messageDraftPurposeSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../../../lib/owner";
import { withModelSafeStoreErrors } from "../../../lib/store-errors";

const inputSchema = z.object({
  personId: z.uuid().describe("The resolved Tendnote person to propose message wording for."),
  purpose: messageDraftPurposeSchema
    .optional()
    .describe("Why the message is being written. Defaults to other."),
  channel: messageDraftChannelSchema
    .optional()
    .describe("How the owner plans to send it themselves. Defaults to text."),
  toneInstruction: z
    .string()
    .optional()
    .describe("Optional owner tone or revision request, passed through verbatim."),
  toneVariants: z
    .array(z.string().min(1))
    .min(1)
    .max(3)
    .optional()
    .describe("Optional tone variants to generate, such as warm, concise, or professional."),
  includeRestricted: z
    .boolean()
    .optional()
    .describe("Set true only when the owner directly asked to draft about restricted context."),
  revisionContext: z
    .object({
      body: z.string().min(1),
      instruction: z.string().min(1).optional(),
    })
    .optional()
    .describe(
      "When revising an existing draft or proposal variant, include the current body and the owner's revision instruction.",
    ),
  followupContext: z
    .object({
      id: z.uuid(),
      reason: z.string().min(1),
    })
    .optional()
    .describe("When proposing from a due or suggested follow-up, its id and reason."),
  briefItemContext: z
    .object({
      id: z.uuid(),
      title: z.string().min(1),
      reason: z.string().min(1).optional(),
    })
    .optional()
    .describe("When proposing from a current brief item, its id, title, and reason."),
});

export default defineTool({
  description:
    "Return ephemeral, source-grounded Draft Proposals with tone variants. This tool never persists a Tendnote Message Draft, never creates an external/Gmail draft, and never sends anything.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    return withModelSafeStoreErrors(() =>
      proposeDraft({
        ownerUserId,
        personId: input.personId,
        purpose: input.purpose,
        channel: input.channel,
        toneInstruction: input.toneInstruction,
        toneVariants: input.toneVariants,
        directlyRequested: input.includeRestricted ?? false,
        revisionContext: input.revisionContext,
        followupContext: input.followupContext,
        briefItemContext: input.briefItemContext,
      }),
    );
  },
  toModelOutput(output) {
    if (!output.proposal) {
      return {
        type: "json" as const,
        value: {
          proposed: false,
          reason: output.skippedReason,
          guidance:
            "No draft proposal was created. Ask for the smallest clarifying note needed; do not invent wording.",
        },
      };
    }

    return {
      type: "json" as const,
      value: {
        proposed: true,
        person: output.proposal.personDisplayName,
        variants: output.proposal.variants.map((variant) => ({
          label: variant.label,
          toneInstruction: variant.toneInstruction,
          body: variant.body,
        })),
        sourceRefs: output.proposal.sourceRefs.map((sourceRef) => ({
          kind: sourceRef.kind,
          id: sourceRef.id,
          label: sourceRef.label,
          trust: sourceRef.trust,
        })),
        guidance:
          "These are ephemeral Draft Proposals. Do not say a Tendnote draft was saved. Durable persistence requires explicit owner intent through create_message_draft.",
      },
    };
  },
});
