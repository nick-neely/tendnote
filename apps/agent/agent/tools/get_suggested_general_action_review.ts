import { getSuggestedGeneralActionReview } from "@tendnote/db/queries/general-actions";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { toGeneralActionModelRef, toGeneralActionRef } from "../lib/general-action-view";
import { resolveOwnerUserId } from "../lib/owner";

const inputSchema = z.object({
  generalActionId: z.uuid().describe("The persisted suggested action id to pull up."),
});

/**
 * Thin wrapper to load one suggested General Action by id as a fixed typed review
 * component (ADRs 0151, 0152). Returns `found: false` when it is missing or no longer
 * suggested, so a stale proposal is never presented (the interactive card is deferred
 * to #186; for now the model describes the proposal in prose).
 */
export default defineTool({
  description:
    "Pull up one suggested General Action by id for review. Returns the proposal, its grounding source record, and a fixed typed component, or found: false if it is gone or already resolved. The suggestion is tentative until the user accepts it; never present it as an active action.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const review = await getSuggestedGeneralActionReview({
      actorUserId: ownerUserId,
      generalActionId: input.generalActionId,
    });

    if (!review) {
      return { found: false as const };
    }

    return {
      found: true as const,
      component: review.component,
      action: toGeneralActionRef(review.action),
      sourceRecord: review.sourceRecord ? { id: review.sourceRecord.id } : null,
    };
  },
  // TODO(#186): a review card is not wired into the chat surface yet, so the model must
  // describe the proposal in prose. Once #186 renders the card, defer detail to it.
  toModelOutput(output) {
    if (!output.found || !output.action) {
      return {
        type: "json" as const,
        value: {
          found: false,
          guidance: "That suggested action is gone or already resolved. Tell the user.",
        },
      };
    }
    return {
      type: "json" as const,
      value: {
        found: true,
        action: toGeneralActionModelRef(output.action),
        guidance:
          "TENTATIVE, not an active action. Describe it briefly in prose for the user; accept it onto the active ledger only on their explicit say-so.",
      },
    };
  },
});
