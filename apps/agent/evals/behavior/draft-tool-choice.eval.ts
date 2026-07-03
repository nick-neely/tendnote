import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { usedDraftingPath } from "../helpers";

export default defineEval({
  description: "Drafting resolves identity and stays review-only.",
  tags: ["deterministic", "behavior", "drafting"],
  async test(t) {
    await t.send("Draft a short check-in text to Alex about the job search.");

    t.succeeded();
    t.calledTool("search_people", { input: { query: /Alex/i } });
    t.eventsSatisfy("uses a grounded drafting path", (events) => usedDraftingPath(events));
    t.notCalledTool("create_message_draft");
    t.notCalledTool("save_draft_to_gmail");
    t.check(t.reply, includes(/Alex|job|search|draft|text|message/i));
  },
});
