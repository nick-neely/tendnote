import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { without } from "../expectations";

export default defineEval({
  description:
    "An ambiguous reminder request is clarified instead of creating an Action with a guessed alert.",
  tags: ["deterministic", "policy", "general-actions", "reminders", "ambiguity"],
  async test(t) {
    await t.send("Add an action to replace the fridge water filter and remind me sometime soon.");

    t.succeeded();
    t.notCalledTool("create_general_action");
    t.notCalledTool("suggest_general_action");
    t.notCalledTool("propose_asset_actions");
    t.check(t.reply, includes(/when|what time|which date|clarif|specific/i));
    t.check(
      t.reply,
      includes(
        without(
          "I(’|')?ve (added|created|set|scheduled)|it(’|')?s (now )?(on|in) your (list|actions|ledger)|I(’|')?ll remind you",
        ),
      ),
    );
  },
});
