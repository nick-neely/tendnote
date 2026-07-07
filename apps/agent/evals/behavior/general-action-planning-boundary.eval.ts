import { defineEval } from "eve/evals";

export default defineEval({
  description: "A planning request never silently creates active General Actions.",
  tags: ["deterministic", "behavior", "general-actions"],
  async test(t) {
    await t.send("Help me plan a weekend camping trip — what should I get done beforehand?");

    t.succeeded();
    // Planning is review-gated at most: it may propose suggestions, but it must never
    // put active actions on the ledger from a brainstorming ask (ADRs 0159, 0163).
    t.notCalledTool("create_general_action");
    t.notCalledTool("update_general_action_status");
    t.notCalledTool("edit_general_action");
  },
});
