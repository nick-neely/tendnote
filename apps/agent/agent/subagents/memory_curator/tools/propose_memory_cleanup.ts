import { getMemoryCuratorProposals } from "@tendnote/db/queries/memory-curator";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../../../lib/owner";

const inputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Maximum review-only cleanup proposals to return. Defaults to 20."),
});

export default defineTool({
  description:
    "Read eligible owner-scoped Memories and Source Records and return review-only memory cleanup proposals with source grounding. This tool never approves, edits, archives, merges, or deletes durable Memories.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    return getMemoryCuratorProposals({ ownerUserId, limit: input.limit });
  },
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        count: output.proposals.length,
        proposals: output.proposals.map((proposal) => ({
          kind: proposal.kind,
          person: proposal.personDisplayName,
          title: proposal.title,
          reason: proposal.reason,
          suggestedAction: proposal.suggestedAction,
          sourceRefs: proposal.sourceRefs.map((sourceRef) => ({
            kind: sourceRef.kind,
            id: sourceRef.id,
            label: sourceRef.label,
          })),
          sensitivity: proposal.sensitivity,
          reviewOnly: proposal.reviewOnly,
        })),
        guidance:
          "These are review-only cleanup proposals. Do not claim anything changed; durable Memory edits, archives, merges, or deletes require explicit owner review through Tendnote surfaces.",
      },
    };
  },
});
