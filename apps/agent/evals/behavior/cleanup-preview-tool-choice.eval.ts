import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
  description: "Cleanup Preview requests use the sandbox preview tool without durable writes.",
  tags: ["deterministic", "behavior", "cleanup-preview", "tool-choice"],
  async test(t) {
    await t.send(
      [
        "Preview this messy cleanup input before saving anything:",
        "name,email,phone,note",
        "Maya,maya@example.com,(555) 111-2222,Met at the design meetup",
        "Maya,MAYA@example.com,,duplicate row",
      ].join("\n"),
    );

    t.succeeded();
    t.calledTool("cleanup_preview");
    t.notCalledTool("create_person");
    t.notCalledTool("capture_memory");
    t.notCalledTool("capture_source_record");
    t.notCalledTool("create_followup");
    t.notCalledTool("propose_followup");
    t.notCalledTool("create_message_draft");
    t.check(t.reply, includes(/preview|review|save|saved|confirm/i));
  },
});
