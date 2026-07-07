import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
  description:
    "An explicit ask to add an action creates an active General Action, not a suggestion.",
  tags: ["deterministic", "behavior", "general-actions", "tool-choice"],
  async test(t) {
    await t.send("Add an action to replace the fridge water filter next month.");

    t.succeeded();
    t.calledTool("create_general_action");
    // Explicit creation is direct — it does not route through the review-gated seam.
    t.notCalledTool("suggest_general_action");
    t.notCalledTool("plan_suggested_general_actions");
    t.check(t.reply, includes(/action|added|list|filter/i));
  },
});
