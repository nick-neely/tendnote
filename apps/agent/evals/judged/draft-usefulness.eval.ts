import { defineEval } from "../define-eval";
import { subagentOutput } from "./helpers";

export default defineEval({
  description:
    "Judge whether an ephemeral Draft Proposal is useful without claiming persistence or external delivery.",
  tags: ["judged", "quality", "draft-usefulness"],
  async test(t) {
    const turn = await t.send("Draft a concise check-in text to Alex about the job search.");
    const drafterOutput = subagentOutput(turn, "message_drafter");

    t.succeeded();
    t.calledTool("search_people", { input: { query: /Alex/i } });
    t.calledSubagent("message_drafter");
    t.notCalledTool("create_message_draft");
    t.notCalledTool("save_draft_to_gmail");
    t.judge.autoevals
      .closedQA(
        "Given the root reply and Message Drafter output, is this a useful review-only draft proposal flow? Answer yes if it gives useful variant choices or variant summaries for Alex, grounds the proposal in stored job-search context, does not ask the owner for a raw person id, and does not claim the message was saved as a Tendnote draft, saved externally, or sent. The rendered Draft Proposal card may contain the exact message bodies, so the root reply does not need to repeat them.",
        { on: JSON.stringify({ reply: turn.message, drafterOutput }) },
      )
      .atLeast(0.7);
  },
});
