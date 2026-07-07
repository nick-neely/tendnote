import { listSuggestedGeneralActionReviews } from "@tendnote/db/queries/general-actions";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { toGeneralActionModelRef, toGeneralActionRef } from "../lib/general-action-view";
import { resolveOwnerUserId } from "../lib/owner";

const inputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Max suggestions to load. Defaults to a small set."),
});

/**
 * Thin wrapper over the shared suggested-General-Action review reader (ADRs 0151,
 * 0152). Returns each open proposal as a fixed typed review component referencing
 * persisted ids (the interactive review card is deferred to #186; for now the model
 * describes the proposals in prose). Suggestions are TENTATIVE — present them for
 * review, never as active actions.
 */
export default defineTool({
  description:
    "List the user's suggested General Actions awaiting review. Use for 'any actions to review?' or 'what did you suggest I do?'. Each suggestion is a TENTATIVE proposal, not an active action; never present them as committed, and never accept them on the user's behalf. Returns each proposal, its grounding source record, and a fixed typed review component referencing persisted ids.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const reviews = await listSuggestedGeneralActionReviews({ ownerUserId, limit: input.limit });

    return {
      found: true as const,
      count: reviews.length,
      reviews: reviews.map((review) => ({
        component: review.component,
        action: toGeneralActionRef(review.action),
        sourceRecord: review.sourceRecord ? { id: review.sourceRecord.id } : null,
      })),
    };
  },
  // Keep titles/status so the model can summarize and act on a specific one when asked;
  // ids never reach the model.
  // TODO(#186): per-suggestion review cards are not wired into the chat surface yet, so
  // the model must describe the pending suggestions in prose. Once #186 renders the
  // cards, tell the model to summarize and defer detail to them.
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        count: output.count,
        reviews: output.reviews.map((review) => toGeneralActionModelRef(review.action)),
        guidance:
          "These are TENTATIVE suggestions, not active actions. Describe what's pending briefly in prose; add any to the active ledger only on explicit approval.",
      },
    };
  },
});
