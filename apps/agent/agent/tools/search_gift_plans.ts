import { listGiftPlans, searchGiftPlans } from "@tendnote/db/queries/gift-plans";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  query: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe(
      "Words from the person's name or the occasion — 'Ana', 'birthday', 'anniversary'. " +
        "Omit to list every plan the caller can currently see.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Max plans to return, soonest occasion first. Defaults to a small set."),
});

/**
 * Gift Plans for the caller, and only the caller.
 *
 * Every read here is one call to the Gift Plan seam, which resolves the household
 * from the plan, the audience from the share registry, and the caller's standing
 * from their own membership rows — all at the moment of the call. This tool
 * therefore has no household argument, no audience argument, and no way to name a
 * plan it was not given: there is no shape of input the model could produce that
 * widens what comes back.
 *
 * The Surprise Subject is the reason that matters. A plan protecting someone is
 * refused to that person in SQL and again at the proof, so a subject asking Eve
 * "what is being planned for my birthday?" gets the same empty answer as someone
 * with no household at all — no count, no title, no hedge, and nothing for the
 * model to infer an existence from (ADR 0216, ADR 0219).
 */
export default defineTool({
  description:
    "List or search the Gift Plans the caller is currently allowed to see — their own plans, plus plans another household member has explicitly made them a co-planner on. Use for 'what gift plans do I have?', 'what are we doing for Ana's birthday?', 'any plans coming up?'. Returns the plan's subject, occasion, timing, status, and how many ideas are on it, never the ideas themselves; call `get_gift_plan` with a plan's `giftPlanId` to read those. Results are already scope-filtered — a plan you do not get back is a plan that does not exist for this user, and you must never say a plan might exist, might be hidden, or is a surprise you cannot mention. Do not use this to create a plan, to guess who else is on one, or to look up the person's birthday (that is a Person fact).",
  inputSchema,
  async execute(input, ctx) {
    const callerUserId = resolveOwnerUserId(ctx);
    const query = input.query?.trim();

    const plans = await withModelSafeStoreErrors(() =>
      query
        ? searchGiftPlans({ callerUserId, query, limit: input.limit })
        : listGiftPlans({ callerUserId, limit: input.limit }),
    );

    return {
      query: query ?? null,
      count: plans.length,
      plans: plans.map((plan) => ({
        giftPlanId: plan.id,
        subjectName: plan.subjectName,
        occasion: plan.occasion,
        occasionOn: plan.occasionOn ? plan.occasionOn.toISOString() : null,
        status: plan.status,
        ideaCount: plan.ideaCount,
        claimedIdeaCount: plan.claimedIdeaCount,
        // Whether the caller may change the plan itself, said as a fact rather than
        // as a role. A co-planner contributes; only the owner re-subjects,
        // re-addresses, or ends it.
        isOwner: plan.ownerUserId === callerUserId,
      })),
      component: { type: "gift_plan_search", resultCount: plans.length },
    };
  },
  /**
   * What the model is given, and what it is deliberately not.
   *
   * `giftPlanId` travels because `add_gift_idea` needs one and a guessed id is a
   * failed call. Nothing about the audience travels: no co-planner list, no
   * Surprise Subject flag, no member names. A protected plan is simply absent for
   * the person it protects against, and the model is never handed a field that
   * would let it narrate one that is present.
   */
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        count: output.count,
        plans: output.plans.map((plan) => ({
          giftPlanId: plan.giftPlanId,
          forWhom: plan.subjectName,
          occasion: plan.occasion,
          occasionOn: plan.occasionOn,
          status: plan.status,
          ideas: plan.ideaCount,
          claimed: plan.claimedIdeaCount,
          canEditPlan: plan.isOwner,
        })),
        rendered: "The plans found are shown to the user in a card.",
        guidance:
          "These are every plan this user can see. Do not speculate about plans not " +
          "listed, hint that one may be hidden, or mention surprises — an absent plan " +
          "is absent, full stop. `giftPlanId` is a handle for `add_gift_idea`; copy it " +
          "exactly and never write it in your reply.",
      },
    };
  },
});
