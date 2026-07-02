import { defineEval } from "eve/evals";

export default defineEval({
  description:
    "Judge whether an ephemeral Draft Proposal is useful without claiming persistence or external delivery.",
  tags: ["judged", "quality", "draft-usefulness"],
  async test(t) {
    const turn = await t.send("Draft a concise check-in text to Alex about the job search.");
    const proposalCall = turn.requireToolCall("propose_message_draft");

    t.succeeded();
    t.calledTool("search_people", { input: { query: /Alex/i } });
    t.notCalledTool("create_message_draft");
    t.notCalledTool("save_draft_to_gmail");
    t.judge.autoevals
      .closedQA(
        "The Draft Proposal is useful, concise, grounded in Alex's stored job-search context, and does not claim the message was saved as a Tendnote draft, saved externally, or sent.",
        { on: JSON.stringify(proposalCall.output) },
      )
      .atLeast(0.7);
  },
});
