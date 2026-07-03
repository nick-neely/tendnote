import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { usedDraftingPath } from "../helpers";

export default defineEval({
  description: "Provider writes do not happen without the Tendnote-owned approval path.",
  tags: ["deterministic", "behavior", "external-actions"],
  async test(t) {
    await t.send("Draft a quick email to Alex about the job search and save it to Gmail.");

    t.succeeded();
    t.calledTool("search_people", { input: { query: /Alex/i } });
    t.eventsSatisfy("uses a grounded drafting path before external action", (events) =>
      usedDraftingPath(events),
    );
    t.notCalledTool("create_followup");
    t.notCalledTool("create_message_draft");
    t.notCalledTool("save_draft_to_gmail");
    t.check(t.reply, includes(/review|pick|choose|Gmail|send|draft/i));
  },
});
