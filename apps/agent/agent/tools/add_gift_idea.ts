import { addGiftIdea } from "@tendnote/db/queries/gift-plans";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

/**
 * The one write Eve may make to a Gift Plan, and only on an explicit request.
 *
 * A Gift Plan's decision doc draws the line precisely: explicit intent may add to
 * a plan *for a currently authorized co-planner*, and grounded suggestions stay in
 * Review until a co-planner adds one themselves. So this tool exists and
 * `create_gift_plan`, `claim_gift_idea`, and any "save what we discussed" variant
 * deliberately do not. Eve never infers a collaborator, persists an idea by
 * itself, chooses surprise protection, or acts on a plan's behalf.
 *
 * Authority is not decided here. The seam proves `view` on the plan — contribution
 * rests on being in its audience, never on authority over it — and refuses the
 * Surprise Subject at the same gate as a read, so someone adding an idea to their
 * own surprise gets the identical single sentence a stranger does (ADR 0216).
 *
 * The one thing a retry must not do is add the idea twice. Reconciliation runs
 * *after* the write commits (see below), so a transport failure there looks exactly
 * like a failed add from where the model is standing - and the model's response to a
 * failed add is to try again, which used to leave "Wool scarf, Wool scarf" on the
 * plan for a co-planner to clean up. The turn plus the title is the key: the same
 * call repeated is one idea, while a genuine second idea in the same turn has a
 * different title and is a different key.
 */
export default defineTool({
  description:
    "Add one gift idea to a Gift Plan the caller is already a co-planner on, when they explicitly ask you to ('add a wool scarf to Ana's birthday plan'). Requires a giftPlanId from `search_gift_plans` — never guess one. The idea is attributed to the caller. Do NOT use this to record something you inferred from conversation, to create a plan, to claim an idea for someone, to add an idea on another person's behalf, or to save a suggestion the user has not asked you to save; an idea you thought of belongs in your reply, not in their plan.",
  inputSchema: z.object({
    giftPlanId: z
      .uuid()
      .describe("The plan's id, copied exactly from a prior `search_gift_plans` result."),
    title: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("The gift itself, in the user's own words. Short — 'wool scarf', not a pitch."),
    note: z
      .string()
      .trim()
      .max(4000)
      .optional()
      .describe("Optional detail the user gave: size, colour, where they saw it."),
    url: z.url().max(2000).optional().describe("Optional link the user supplied. Never invented."),
  }),
  async execute(input, ctx) {
    const actorUserId = resolveOwnerUserId(ctx);

    const outcome = await withModelSafeStoreErrors(() =>
      addGiftIdea({
        actorUserId,
        giftPlanId: input.giftPlanId,
        title: input.title,
        note: input.note,
        url: input.url,
        // Session, turn, and the idea's own words. Derived here rather than asked
        // for: a key the model supplies is a key the model can vary on the retry it
        // is meant to suppress.
        idempotencyKey: `eve:${ctx.session.id}:${ctx.session.turn.id}:${input.title.toLowerCase()}`,
      }),
    );

    // Every co-planner's cached view of this plan now describes a state one idea
    // out of date. Best-effort by design: the write has committed, and a cache
    // transport failure must not read as a failed add and invite a duplicate.
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);

    return {
      added: true as const,
      giftIdeaId: outcome.result.id,
      giftPlanId: input.giftPlanId,
      title: outcome.result.title,
      // Whether this call is the one that wrote it. A repeat is still an idea on the
      // plan, so the card and the confirmation are the same either way.
      decision: outcome.decision,
      component: { type: "gift_idea_added", title: outcome.result.title },
    };
  },
  /**
   * `giftIdeaId` travels for the same reason `search_gift_plans` sends `giftPlanId`:
   * `edit_gift_idea` and `remove_gift_idea` take one, and this is the only place the
   * model can get it - an idea the user asks to correct a moment later is otherwise
   * unreachable. Still nothing about the audience travels.
   */
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        added: true,
        giftIdeaId: output.giftIdeaId,
        title: output.title,
        guidance:
          "Confirm the idea was added to the plan, by its title. Do not name the other " +
          "co-planners, do not say who else has claimed anything, and never write a raw id. " +
          "`giftIdeaId` is the handle `edit_gift_idea` and `remove_gift_idea` take if the " +
          "user corrects or retracts this idea; copy it exactly and keep it out of your reply.",
      },
    };
  },
});
