import { defineEval } from "eve/evals";

export default defineEval({
  description: "Architecture diagnostic: first-pass drafting can route to Message Drafter.",
  tags: ["architecture", "drafting", "subagent"],
  async test(t) {
    await t.send(
      "Use the message drafter to write a short check-in text to Alex about the job search.",
    );

    t.succeeded();
    t.calledTool("search_people", { input: { query: /Alex/i } });
    t.calledSubagent("message_drafter", {
      output: /variant|proposal|draft|text|message/i,
    });
    t.notCalledTool("create_message_draft");
    t.notCalledTool("save_draft_to_gmail");
  },
});
