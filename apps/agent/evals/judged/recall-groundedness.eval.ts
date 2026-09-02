import { satisfies } from "eve/evals/expect";
import { defineEval } from "../define-eval";

export default defineEval({
  description: "Judge recall tone, factuality, and grounded summarization.",
  tags: ["judged", "quality", "tone", "factuality", "grounded-summary"],
  async test(t) {
    const turn = await t.send(
      "What should I keep in mind about Alex's job search? Keep it literal: don't infer work style from unrelated keyboard notes.",
    );
    const contextCall = turn.requireToolCall("get_person_context");

    t.succeeded();
    t.calledTool("search_people", { input: { query: /Alex/i } });
    t.calledTool("get_person_context");
    t.check(
      turn.message,
      satisfies(
        (reply) =>
          !/(quieter,? more focused work rhythm|quieter work rhythm|focus time|async-friendly|companies or teams known|approaches comfort and preferences at work|work[- ]style preferences)/i.test(
            String(reply),
          ),
        "does not infer workplace culture or work style beyond stored wording",
      ),
    );
    t.judge.autoevals
      .closedQA(
        "Given the loaded person context and reply, does the reply stay concise and natural, ground its Alex job-search answer in the loaded context, distinguish confirmed facts from logged context, and avoid inventing employers, interviews, deadlines, workplace-culture preferences, or other personal facts?",
        { on: JSON.stringify({ reply: turn.message, context: contextCall.output }) },
      )
      .atLeast(0.7);
  },
});
