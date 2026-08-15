import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { NO_RAW_IDS, without } from "../expectations";

/**
 * A reminder time inferred from reviewed context is still a proposal, not an
 * active schedule. The user asks for a recommendation and explicitly defers
 * the decision, so no Action or Reminder Schedule may be attached.
 */
export default defineEval({
  description:
    "Eve keeps inferred asset reminder timing in review instead of attaching an active schedule.",
  tags: ["deterministic", "policy", "assets", "reminders", "general-actions"],
  async test(t) {
    await t.send(
      "Based on the kitchen refrigerator's warranty details, what reminder timing would you suggest? Do not add or schedule anything yet.",
    );

    t.succeeded();
    t.calledTool("propose_asset_actions");
    t.notCalledTool("create_general_action");
    t.notCalledTool("edit_general_action");
    t.notCalledTool("accept_suggested_general_action");
    t.check(t.reply, includes(/review|suggest|recommend|propos/i));
    t.check(
      t.reply,
      includes(
        without(
          "I(’|')?ve (added|created|set|scheduled)|I(’|')?ll remind you|you(’|')?ll get a reminder|it(’|')?s (now )?(on|in) your (list|actions|ledger)",
        ),
      ),
    );
    t.check(t.reply, includes(NO_RAW_IDS));
  },
});
