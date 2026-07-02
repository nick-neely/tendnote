import { defineEval } from "eve/evals";

export default defineEval({
  description: "Judge whether a relationship-agenda style answer is useful and bounded.",
  tags: ["judged", "quality", "brief-usefulness", "instruction-quality"],
  async test(t) {
    await t.send("Give me a brief for relationship follow-ups and check-ins this week.");

    t.succeeded();
    t.notCalledTool("create_followup");
    t.notCalledTool("create_message_draft");
    t.judge.autoevals
      .closedQA(
        "The answer is a useful brief: concise, actionable, scoped to existing Tendnote records, and careful not to invent tasks or overstate suggested items as confirmed obligations.",
      )
      .atLeast(0.7);
    t.judge.autoevals
      .closedQA(
        "The answer follows Tendnote's instruction style: calm, natural, not salesy, and clear about review or tentative context when relevant.",
      )
      .atLeast(0.7);
  },
});
