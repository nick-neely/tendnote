import { getSuggestedGeneralActionReview } from "@tendnote/db/queries/general-actions";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { toGeneralActionModelRef, toGeneralActionRef } from "../lib/general-action-view";
import { resolveOwnerUserId } from "../lib/owner";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  generalActionId: z.uuid().describe("The persisted suggested action id to pull up."),
});

/**
 * Thin wrapper to load one suggested General Action by id as a fixed typed review
 * component (ADRs 0151, 0152). Returns `found: false` when it is missing or no longer
 * suggested, so a stale proposal is never presented. When found, the chat renders it as
 * an interactive review card (Accept/Dismiss); when gone, the model says so in prose.
 */
export default defineTool({
  description:
    "Pull up one suggested General Action by id for review. Returns the proposal, its grounding source record, and a fixed typed component, or found: false if it is gone or already resolved. The suggestion is tentative until the user accepts it; never present it as an active action.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const review = await withModelSafeStoreErrors(() =>
      getSuggestedGeneralActionReview({
        actorUserId: ownerUserId,
        generalActionId: input.generalActionId,
      }),
    );

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
  // When found, the chat renders an interactive review card (Accept/Dismiss); when gone,
  // there's nothing to render, so the model simply says so in prose.
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
        rendered: "The suggestion is shown to the user in a review card.",
        guidance:
          "TENTATIVE, not an active action — it's shown as a review card the user can accept or dismiss. Point to it in a sentence; don't restate its details.",
      },
    };
  },
});
