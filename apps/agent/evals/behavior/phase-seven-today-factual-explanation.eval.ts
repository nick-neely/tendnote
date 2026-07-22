import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { without } from "../expectations";

export default defineEval({
  description:
    "Eve describes today's General Actions from authoritative dates and state without inventing priority.",
  tags: ["deterministic", "behavior", "today", "general-actions", "phase-seven"],
  async test(t) {
    await t.send(
      "Which General Actions are due today? Give me only the factual date or state reason for each; do not decide what my priority should be.",
    );

    t.succeeded();
    t.calledTool("list_general_actions", { input: { window: "today" } });
    t.notCalledTool("create_general_action");
    t.notCalledTool("update_general_action_status");
    t.notCalledTool("edit_general_action");
    t.check(
      t.reply,
      includes(without("highest priority|most important|top priority|you should prioritize")),
    );
  },
});
