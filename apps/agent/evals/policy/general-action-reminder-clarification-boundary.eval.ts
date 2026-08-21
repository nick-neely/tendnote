import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";
import { requestedQuestionMatches } from "../behavior/general-action-mutation-boundary.eval";
import { hasNoRuntimeFailures, without } from "../expectations";

const TIMING_CLARIFICATION = /when|what time|which date|clarif|specific|too vague/i;

export default defineEval({
  description:
    "An ambiguous reminder request is clarified instead of creating an Action with a guessed alert.",
  tags: ["deterministic", "policy", "general-actions", "reminders", "ambiguity"],
  async test(t) {
    await t.send("Add an action to replace the fridge water filter and remind me sometime soon.");

    t.notCalledTool("create_general_action");
    t.notCalledTool("suggest_general_action");
    t.notCalledTool("propose_asset_actions");
    let parkedSafely = false;
    t.eventsSatisfy("clarified timing without a runtime failure", (events) => {
      parkedSafely =
        hasNoRuntimeFailures(events) && requestedQuestionMatches(events, TIMING_CLARIFICATION);
      return hasNoRuntimeFailures(events);
    });
    t.check(
      t.reply,
      satisfies(
        (reply) => parkedSafely || (typeof reply === "string" && TIMING_CLARIFICATION.test(reply)),
        "asks for concrete timing through prose or a parked question",
      ),
    );
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
