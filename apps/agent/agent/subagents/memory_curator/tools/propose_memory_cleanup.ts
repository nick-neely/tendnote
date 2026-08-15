import { getMemoryCuratorProposals } from "@tendnote/db/queries/memory-curator";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../../../lib/owner";
import { withModelSafeStoreErrors } from "../../../lib/store-errors";

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
    "Read eligible owner-scoped Memories and Source Records and return review-only memory cleanup proposals with source grounding. Use this once when the owner asks to tidy, clean up, review, or make sense of what Tendnote remembers - duplicates, stale memories, notes that contradict each other, or memories too vague to be useful. It is the only way to find cleanup candidates: never assemble one by reasoning about what the owner probably has. This tool never approves, edits, archives, merges, or deletes durable Memories, and nothing it returns has changed anything.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const result = await withModelSafeStoreErrors(() =>
      getMemoryCuratorProposals({ ownerUserId, limit: input.limit }),
    );

    // The owner id the shared read echoes back is scoping metadata, not part of a
    // proposal: it identifies the caller to the caller. It stops here rather than
    // riding out to the channel with every card.
    return {
      component: result.component,
      proposals: result.proposals.map(({ ownerUserId: _ownerUserId, ...proposal }) => proposal),
    };
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
          // Kind and label, never the record id: this agent has no tool that takes
          // one, so an id in its view is an id it can only print. The channel still
          // gets the full refs above for the review card.
          sourceRefs: proposal.sourceRefs.map((sourceRef) => ({
            kind: sourceRef.kind,
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
