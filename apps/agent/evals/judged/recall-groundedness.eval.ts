import { defineEval } from "eve/evals";

export default defineEval({
  description: "Judge recall tone, factuality, and grounded summarization.",
  tags: ["judged", "quality", "tone", "factuality", "grounded-summary"],
  async test(t) {
    await t.send("What should I keep in mind about Alex's job search?");

    t.succeeded();
    t.calledTool("search_people", { input: { query: /Alex/i } });
    t.calledTool("get_person_context");
    t.judge.autoevals
      .factuality(
        "Alex is job hunting and prefers backend platform work with fewer meetings. The answer should not invent employers, interviews, deadlines, or personal facts.",
      )
      .atLeast(0.7);
    t.judge.autoevals
      .closedQA(
        "The answer is concise, natural, and distinguishes stored facts or logged context from speculation.",
      )
      .atLeast(0.7);
  },
});
