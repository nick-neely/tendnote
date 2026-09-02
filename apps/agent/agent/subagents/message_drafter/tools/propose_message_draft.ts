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

/**
 * There is deliberately no `includeRestricted` here.
 *
 * Restricted context is revealed only on the owner's own direct request in the
 * current turn (ADR 0058), and the owner's turn reached the *root* agent. A
 * subagent runs on a delegated task with nobody to ask, so a flag on this schema
 * could only ever be the model vouching for a request it never heard - which is
 * exactly the assertion a prompt injection mints. Gating it would be no better:
 * the approval seam denies a subagent turn, so a set flag would kill the whole
 * proposal instead of narrowing it. Omitting the field pins `directlyRequested`
 * to false and leaves the proposal grounded in ordinary context. If the owner
 * really did ask for a delicate topic, the root's `create_message_draft` carries
 * `includeRestricted` and can put that question to them.
 */
export default defineTool({
  description:
    "Return ephemeral, source-grounded Draft Proposals with tone variants. Restricted-sensitivity context is never included; only the root agent, with the owner present to approve it, can draft from that. This tool never persists a Tendnote Message Draft, never creates an external/Gmail draft, and never sends anything.",
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
        // Not a model-facing argument: see the note above the tool.
        directlyRequested: false,
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
          // Binds this exact wording to the proposal that issued it. The owner's
          // acceptance travels to the root's `create_message_draft` as
          // `acceptedProposal.digest`, and persistence recomputes it: a body
          // altered on the way past no longer matches and is refused.
          digest: variant.digest,
        })),
        sourceRefs: output.proposal.sourceRefs.map((sourceRef) => ({
          kind: sourceRef.kind,
          id: sourceRef.id,
          label: sourceRef.label,
          trust: sourceRef.trust,
        })),
        guidance:
          "These are ephemeral Draft Proposals. Do not say a Tendnote draft was saved. Durable persistence requires explicit owner intent through create_message_draft, which needs the chosen variant's body and digest and the sourceRefs above, copied exactly.",
      },
    };
  },
});
