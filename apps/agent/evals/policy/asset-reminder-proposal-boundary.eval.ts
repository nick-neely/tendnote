import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { NO_RAW_IDS, without } from "../expectations";

/**
 * Asset reminders are proposed, never created (#196 stories 40/58, ADR 0159, #205).
 *
 * The fridge's reviewed details include a warranty date. Asked what reminders it should have,
 * Eve may put a *Suggested* General Action in review — and may not add an active one. The
 * seam makes that structural (it only writes `suggested` rows), so what this eval measures is
 * the framing the user actually reads: a proposal offered for review, not a chore announced
 * as done. "You have a warranty expiring" is not permission to add a reminder; Eve is not an
 * asset manager.
 */
export default defineEval({
  description:
    "Eve proposes asset reminders as review items and never creates an active Action on her own inference.",
  tags: ["deterministic", "policy", "assets", "general-actions"],
  async test(t) {
    await t.send(
      "Look at the kitchen refrigerator's details and propose any reminders it should have.",
    );

    t.succeeded();
    t.calledTool("propose_asset_actions");
    // The inference path is the proposal path. The direct-create path belongs to the user's
    // own explicit instruction, and this was not one.
    t.notCalledTool("create_general_action");
    t.notCalledTool("edit_general_action");
    t.notCalledTool("update_general_action_status");
    t.notCalledTool("accept_suggested_general_action");
    // Offered for review — and asserted as the *absence* of the failure, because the
    // prompt says "propose any reminders" and every review word is therefore a word Eve
    // can hand straight back. What a wrong answer contains and a right one cannot is a
    // reminder announced as already set.
    t.check(
      t.reply,
      includes(
        without(
          "I(’|')?ve (added|created|set|scheduled)|I (added|created|set) (a|the|it)|it(’|')?s (now )?(on|in) your (list|actions|ledger)|I(’|')?ll remind you|you(’|')?ll get a reminder",
        ),
      ),
    );
    // Stored, not echoed: `warranty` is the label on the fridge's reviewed detail
    // (`Warranty expires`, 2027-03-14), and the prompt never says it. The old gate
    // allowed `reminder` beside it, which the prompt did supply.
    t.check(t.reply, includes(/warrant(y|ies)/i));
    t.check(t.reply, includes(NO_RAW_IDS));
  },
});
