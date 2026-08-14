import { getGiftPlanDetail } from "@tendnote/db/queries/gift-plans";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { withModelSafeStoreErrors } from "../lib/store-errors";

/**
 * How many ideas one plan hands back.
 *
 * A Gift Plan is a short list two people are building, not a catalogue, so this
 * is a ceiling on a pathological plan rather than a paging story. It is a default
 * the model can raise up to the schema maximum, and the result says when it
 * truncated so a missing idea is never silent.
 */
const DEFAULT_GIFT_IDEA_LIMIT = 20;

const inputSchema = z.object({
  giftPlanId: z
    .uuid()
    .describe(
      "The plan's id, copied exactly from a prior `search_gift_plans` result. Never guess one: a plan you did not get back from that search is a plan that does not exist for this user.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(DEFAULT_GIFT_IDEA_LIMIT)
    .describe(
      `Max ideas to return, oldest first. Defaults to ${DEFAULT_GIFT_IDEA_LIMIT}, which is every idea on an ordinary plan.`,
    ),
});

/**
 * The ideas on one plan, and the only place their handles exist across sessions.
 *
 * `search_gift_plans` returns counts, not ideas. So the only `giftIdeaId` in Eve's
 * context was the one `add_gift_idea` had just minted, which made `edit_gift_idea`
 * and `remove_gift_idea` usable for exactly as long as that conversation lasted:
 * "actually make that the cashmere one" worked a minute after adding, and was
 * unanswerable the next morning. This read closes that loop and does nothing else.
 *
 * It is the *same* proof, not a similar one. `getGiftPlanDetail` runs
 * `proveRecordAccess({ operation: "view" })` on the plan before it reads an idea,
 * exactly as `add_gift_idea`, `edit_gift_idea`, and `remove_gift_idea` do - so a
 * Surprise Subject asking Eve about the plan for their own birthday is refused at
 * the same gate a stranger is, and gets the identical `found: false` a caller with
 * no household at all gets: no count, no title, no hedge, and nothing to infer an
 * existence from (ADR 0216, ADR 0219). There is no household argument, no audience
 * argument, and no shape of input that widens the read.
 *
 * What deliberately does not travel: who contributed an idea, who claimed one, and
 * the plan's event history. A claim is what stops two co-planners buying the same
 * scarf; naming the claimer is gossip about a household, and the plan's own surface
 * is where that belongs.
 */
export default defineTool({
  description:
    "Open ONE Gift Plan the caller can already see and read the ideas on it - 'what's on Ana's birthday plan?', 'what have we come up with so far?', 'what did I add for Rowan?'. Requires a giftPlanId from `search_gift_plans`; call that first and never guess an id. Returns each idea's title, note, and link, whether it is already claimed by someone, and whether the caller added it - plus the `giftIdeaId` handle `edit_gift_idea` and `remove_gift_idea` take, which is the only way to correct or retract an idea added in an earlier conversation. A plan you cannot open is a plan that does not exist for this user: say you do not see one and never suggest it might be hidden, might exist, or is a surprise you cannot mention. Do not use this to create a plan, to claim an idea, to guess who else is on the plan, or to look up the person's birthday (that is a Person fact).",
  inputSchema,
  async execute(input, ctx) {
    const callerUserId = resolveOwnerUserId(ctx);

    const detail = await withModelSafeStoreErrors(() =>
      getGiftPlanDetail({ callerUserId, giftPlanId: input.giftPlanId }),
    );

    // `null` is the whole refusal: a plan that does not exist and a plan this caller
    // may not see are the same answer, produced at the same gate.
    if (!detail) {
      return { found: false as const, plan: null, count: 0, truncated: false, ideas: [] };
    }

    const shown = detail.ideas.slice(0, input.limit);

    return {
      found: true as const,
      plan: {
        giftPlanId: detail.plan.id,
        subjectName: detail.plan.subjectName,
        occasion: detail.plan.occasion,
        occasionOn: detail.plan.occasionOn ? detail.plan.occasionOn.toISOString() : null,
        status: detail.plan.status,
        ideaCount: detail.plan.ideaCount,
        claimedIdeaCount: detail.plan.claimedIdeaCount,
        // Whether the caller may change the plan itself, said as a fact rather than as
        // a role - the same field `search_gift_plans` reports, for the same reason.
        isOwner: detail.plan.ownerUserId === callerUserId,
      },
      count: shown.length,
      truncated: shown.length < detail.ideas.length,
      ideas: shown.map((idea) => ({
        giftIdeaId: idea.id,
        title: idea.title,
        note: idea.note,
        url: idea.url,
        // Whether someone has taken it, never who. The fact is what stops a duplicate
        // gift; the name is a fact about another member of the household.
        claimed: idea.claimedByUserId !== null,
        claimedByCaller: idea.claimedByUserId === callerUserId,
        // Only the caller's own contributions are theirs to edit or remove, so the
        // model is told which those are rather than discovering it from a refusal.
        addedByCaller: idea.contributorUserId === callerUserId,
      })),
    };
  },
  /**
   * `giftIdeaId` travels for the same reason `search_gift_plans` sends `giftPlanId`:
   * `edit_gift_idea` and `remove_gift_idea` take one, and without it here they are
   * unreachable for any idea the model did not add in this very conversation.
   *
   * No card. The plan's own surface in the app renders ideas with claim controls this
   * tool deliberately does not offer, and a second, quieter copy of that list in chat
   * would be the one place a claim appears without the button that changes it.
   */
  toModelOutput(output) {
    if (!output.found || !output.plan) {
      return {
        type: "json" as const,
        value: {
          found: false,
          guidance:
            "There is no such plan for this user. Say you do not see it and stop there. Do " +
            "not say it might exist, might be hidden, might be a surprise, or that you " +
            "cannot talk about it, and do not retry with a different id.",
        },
      };
    }

    return {
      type: "json" as const,
      value: {
        found: true,
        forWhom: output.plan.subjectName,
        occasion: output.plan.occasion,
        occasionOn: output.plan.occasionOn,
        status: output.plan.status,
        canEditPlan: output.plan.isOwner,
        count: output.count,
        truncated: output.truncated,
        ideas: output.ideas.map((idea) => ({
          giftIdeaId: idea.giftIdeaId,
          title: idea.title,
          note: idea.note,
          url: idea.url,
          claimed: idea.claimed,
          claimedByCaller: idea.claimedByCaller,
          addedByCaller: idea.addedByCaller,
        })),
        guidance:
          "These are the ideas on the plan. `giftIdeaId` is the handle `edit_gift_idea` " +
          "and `remove_gift_idea` take - copy one exactly and never write it in your " +
          "reply. Only ideas with `addedByCaller` are the user's to change; for anyone " +
          "else's, say it is not theirs to edit rather than trying. Say that an idea is " +
          "claimed when it matters, but never name who claimed it or who added it, and " +
          "never name the other co-planners." +
          (output.truncated
            ? " More ideas are on the plan than were returned: say so plainly rather than implying this is all of them."
            : ""),
      },
    };
  },
});
