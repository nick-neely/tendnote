import { editGiftIdea } from "@tendnote/db/queries/gift-plans";
import { GiftPlanValidationError } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

/**
 * Correcting what the caller already contributed, and only that.
 *
 * The same seam and the same proof `add_gift_idea` runs: `view` on the plan, read
 * from memberships and the share registry at the moment of the call, with the
 * Surprise Subject refused at that gate rather than filtered afterwards (ADR 0216,
 * ADR 0219). On top of it the domain asserts contributorship, so a co-planner's idea
 * is not Eve's to re-word even when the caller can see it - and the refusal is the
 * family's one opaque sentence, which names no plan, no idea, and no person.
 *
 * The id has to have come from somewhere real. `add_gift_idea` returns one, which is
 * the case this exists for: "add a wool scarf… actually make it cashmere" inside one
 * conversation. There is deliberately no title-matching path - an idea resolved by
 * words the model recognized is an idea it can resolve wrongly, and the wrong idea
 * here belongs to somebody else.
 */
export default defineTool({
  description:
    "Change an idea the caller themselves put on a Gift Plan, when they explicitly say so in this turn ('make that the cashmere one, not wool', 'add the link I just sent'). Requires a giftIdeaId you already have from adding it in this conversation - never guess one, and never resolve an idea by matching its title. You may only change your own contribution: someone else's idea is theirs, and the attempt is refused. Pass only the fields that change (title, note, url). Do NOT use this to tidy up wording on your own initiative, to re-price or re-source an idea from something you found, to claim or unclaim one, or to edit the plan itself. If the user is talking about an idea you have not seen in this conversation, say so and point them at the plan in the app rather than guessing.",
  inputSchema: z.object({
    giftIdeaId: z
      .uuid()
      .describe(
        "The idea's id, copied exactly from the `add_gift_idea` result that created it in this conversation.",
      ),
    title: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("New title, in the user's own words. Omit to leave it unchanged."),
    note: z
      .string()
      .trim()
      .max(4000)
      .nullable()
      .optional()
      .describe("New detail the user gave; pass null to clear it, omit to leave it unchanged."),
    url: z
      .url()
      .max(2000)
      .nullable()
      .optional()
      .describe(
        "New link the user supplied - never one you found or invented; pass null to clear it, omit to leave it unchanged.",
      ),
  }),
  async execute(input, ctx) {
    const actorUserId = resolveOwnerUserId(ctx);

    // An edit that changes nothing is a confirmation the user never earned. Refused
    // before the call so nothing reports success for a no-op.
    if (input.title === undefined && input.note === undefined && input.url === undefined) {
      throw new GiftPlanValidationError("Say what to change about the idea.");
    }

    const outcome = await withModelSafeStoreErrors(() =>
      editGiftIdea({
        actorUserId,
        giftIdeaId: input.giftIdeaId,
        edit: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(input.url !== undefined ? { url: input.url } : {}),
        },
      }),
    );

    // Every co-planner's cached view of this plan is now one edit out of date.
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);

    return {
      updated: true as const,
      giftIdeaId: outcome.result.id,
      title: outcome.result.title,
    };
  },
  /** No card: an edit to an existing idea is a sentence, not a new thing on the plan. */
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        updated: true,
        giftIdeaId: output.giftIdeaId,
        title: output.title,
        guidance:
          "Confirm briefly what the idea says now, by its title. Do not name the other " +
          "co-planners, do not say who has claimed anything, and never write a raw id.",
      },
    };
  },
});
