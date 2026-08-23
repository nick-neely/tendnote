import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";
import { hasReviewGatedGeneralActionPlan, isUntruthfulActionMutationClaim } from "../expectations";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default defineEval({
  description: "A planning request never silently creates active General Actions.",
  tags: ["deterministic", "behavior", "general-actions"],
  async test(t) {
    await t.send("Help me plan a weekend camping trip — what should I get done beforehand?");

    t.succeeded();
    // Planning grounds every review card in the note it first captures. The card
    // payload, not the root prose, is the authoritative list of proposed steps.
    t.calledTool("capture_source_record", {
      input: {
        retainedContent: (value: unknown) => typeof value === "string" && value.trim().length > 0,
      },
      count: 1,
    });
    t.calledTool("plan_suggested_general_actions", {
      input: {
        sourceRecordId: UUID,
        steps: (value: unknown) => Array.isArray(value) && value.length > 0 && value.length <= 5,
      },
      count: 1,
    });
    t.toolOrder(["capture_source_record", "plan_suggested_general_actions"]);
    t.eventsSatisfy("the plan returned grounded Suggested Action review cards", (events) =>
      hasReviewGatedGeneralActionPlan(events),
    );
    // Planning is review-gated at most: it may propose suggestions, but it must never
    // put active actions on the ledger from a brainstorming ask (ADRs 0159, 0163).
    t.notCalledTool("create_general_action");
    t.notCalledTool("update_general_action_status");
    t.notCalledTool("edit_general_action");
    t.notCalledTool("accept_suggested_general_action");
    t.notCalledTool("dismiss_suggested_general_action");
    // The cards already render the concrete steps. Keep only the brief review-gated
    // framing and reject an untruthful claim that the suggestions became active.
    t.check(t.reply, includes(/review|suggest|accept|dismiss/i));
    t.check(
      t.reply,
      satisfies(
        (reply) => typeof reply === "string" && !isUntruthfulActionMutationClaim(reply),
        "planning does not claim review cards are active",
      ),
    );
  },
});
