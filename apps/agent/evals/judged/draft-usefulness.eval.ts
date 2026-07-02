import { defineEval } from "eve/evals";

export default defineEval({
  description:
    "Judge whether a generated Tendnote draft is useful without claiming external delivery.",
  tags: ["judged", "quality", "draft-usefulness"],
  async test(t) {
    const turn = await t.send("Draft a concise check-in text to Alex about the job search.");
    const draftCall = turn.requireToolCall("create_message_draft");

    t.succeeded();
    t.calledTool("search_people", { input: { query: /Alex/i } });
    t.notCalledTool("save_draft_to_gmail");
    t.judge.autoevals
      .closedQA(
        "The draft output is useful, concise, grounded in Alex's stored job-search context, and does not claim the message was sent or saved externally.",
        { on: JSON.stringify(draftCall.output) },
      )
      .atLeast(0.7);
  },
});
