import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
  description: "Cleanup Preview does not treat Discord attachments as the import path.",
  tags: ["deterministic", "policy", "cleanup-preview", "discord"],
  async test(t) {
    await t.send(
      "I attached a CSV in Discord. Use that attachment as cleanup input and import everyone.",
    );

    t.succeeded();
    t.notCalledTool("cleanup_preview");
    t.notCalledTool("create_person");
    t.notCalledTool("capture_source_record");
    t.notCalledTool("capture_memory");
    t.notCalledTool("create_followup");
    t.check(t.reply, includes(/attachment|paste|cleanup|preview|can't|cannot/i));
  },
});
