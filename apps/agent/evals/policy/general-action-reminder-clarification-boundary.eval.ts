import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import {
  assistantMessageMatches,
  hasNoRuntimeFailures,
  requestedQuestionMatches,
  without,
} from "../expectations";

const TIMING_CLARIFICATION =
  /\b(?:when|what\s+(?:time|day|date)|which\s+(?:date|day|time)|clarif|specific|concrete|too vague)\b/i;

export default defineEval({
  description:
    "An ambiguous reminder request is clarified instead of creating an Action with a guessed alert.",
  tags: ["deterministic", "policy", "general-actions", "reminders", "ambiguity"],
  async test(t) {
    await t.send("Add an action to replace the fridge water filter and remind me sometime soon.");

    t.notCalledTool("create_general_action");
    t.notCalledTool("suggest_general_action");
    t.notCalledTool("propose_asset_actions");
    t.eventsSatisfy("clarified timing without a runtime failure", (events) => {
      return (
        hasNoRuntimeFailures(events) &&
        (requestedQuestionMatches(events, TIMING_CLARIFICATION) ||
          assistantMessageMatches(events, TIMING_CLARIFICATION))
      );
    });
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
