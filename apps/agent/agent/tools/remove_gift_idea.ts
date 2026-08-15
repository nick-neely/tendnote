import { removeGiftIdea } from "@tendnote/db/queries/gift-plans";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

/**
 * Taking back what the caller just put up, on their say-so.
 *
 * Removal is permanent - a Gift Plan has no hidden archive for ideas - which is
 * exactly why this is the narrowest of the three idea tools: an explicit retraction
 * in the current turn, against an id from this conversation, of the caller's own
 * contribution. The proof is `add_gift_idea`'s: `view` on the plan read now, the
 * Surprise Subject refused at the same gate, contributorship asserted by the domain,
 * and one opaque sentence for every refusal (ADR 0216, ADR 0219).
 *
 * There is no title-matching path and no "clear the plan" shape, because both would
 * make the failure mode "Eve deleted the wrong one, permanently, from a plan two
 * people are building".
 */
export default defineTool({
  description:
    "Remove an idea the caller themselves put on a Gift Plan, when they explicitly ask you to in this turn ('actually take the wool scarf back off'). Requires a giftIdeaId you already have from adding it in this conversation - never guess one, and never resolve an idea by matching its title. You may only remove your own contribution, and removal is permanent: there is no undo and no archive. Do NOT use this to tidy a plan, to clear out ideas you think are duplicates or bad ones, to remove several at once, or to remove anything on your own initiative. If the user means an idea you have not seen in this conversation, say so and point them at the plan in the app.",
  inputSchema: z.object({
    giftIdeaId: z
      .uuid()
      .describe(
        "The idea's id, copied exactly from the `add_gift_idea` result that created it in this conversation.",
      ),
  }),
  async execute(input, ctx) {
    const actorUserId = resolveOwnerUserId(ctx);

    const outcome = await withModelSafeStoreErrors(() =>
      removeGiftIdea({ actorUserId, giftIdeaId: input.giftIdeaId }),
    );

    // Every co-planner's cached view of this plan still counts the removed idea.
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);

    return { removed: true as const, giftIdeaId: outcome.result.giftIdeaId };
  },
  /**
   * Nothing about the idea comes back - the seam returns an id and the idea is gone.
   * The model already knows what it removed from the turn that asked for it, and a
   * title echoed back from an earlier turn is a title it could get wrong.
   */
  toModelOutput() {
    return {
      type: "json",
      value: {
        removed: true,
        guidance:
          "It is off the plan for good. Confirm in one short sentence, without naming the " +
          "other co-planners or who had claimed anything, and never write a raw id. Do not " +
          "offer to put it back - you would be adding a new idea, not restoring this one.",
      },
    };
  },
});
