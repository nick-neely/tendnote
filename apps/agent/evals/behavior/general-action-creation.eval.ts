import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { without } from "../expectations";

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
    // The old gate was `/action|added|list|filter/`, every word of it in the prompt. What
    // distinguishes a correct answer is that the action is reported as *active*, not as a
    // suggestion waiting for review - the exact confusion `create_general_action` vs
    // `suggest_general_action` exists to keep apart.
    t.check(
      t.reply,
      includes(
        without(
          "suggest(ed|ion)|for (your )?review|review queue|waiting for (your )?approval|once you approve",
        ),
      ),
    );
  },
});
