import { defineEval } from "eve/evals";

export default defineEval({
  description: "Broad relationship strategy uses agenda context without durable actions.",
  tags: ["deterministic", "behavior", "relationship-strategy", "subagent"],
  async test(t) {
    await t.send(
      "Who should I prioritize this week, and what thoughtful next action should I consider?",
    );

    t.succeeded();
    t.calledTool("get_relationship_agenda");
    t.notCalledTool("create_followup");
    t.notCalledTool("create_message_draft");
    t.notCalledTool("capture_memory");
    t.notCalledTool("capture_source_record");
    t.notCalledTool("save_draft_to_gmail");
  },
});
