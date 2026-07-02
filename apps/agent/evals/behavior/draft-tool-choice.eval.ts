import { defineEval } from "eve/evals";

export default defineEval({
  description: "Drafting uses identity lookup before proposing ephemeral draft options.",
  tags: ["deterministic", "behavior", "tool-choice", "drafting"],
  async test(t) {
    await t.send("Draft a short check-in text to Alex about the job search.");

    t.succeeded();
    t.calledTool("search_people", { input: { query: /Alex/i } });
    t.calledTool("propose_message_draft");
    t.notCalledTool("create_message_draft");
    t.notCalledTool("save_draft_to_gmail");
    t.toolOrder(["search_people", "propose_message_draft"]);
  },
});
