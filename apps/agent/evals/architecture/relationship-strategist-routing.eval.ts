import { defineEval } from "eve/evals";

export default defineEval({
  description: "Architecture diagnostic: specialist strategy can route to Relationship Strategist.",
  tags: ["architecture", "relationship-strategy", "subagent"],
  async test(t) {
    await t.send(
      "Use your relationship strategist to help me decide who to prioritize this week. Keep it review-only.",
    );

    t.succeeded();
    t.calledSubagent("relationship_strategist", {
      output: /prioritize|recommend|consider|follow-up|birthday|review/i,
    });
    t.notCalledTool("create_followup");
    t.notCalledTool("create_message_draft");
    t.notCalledTool("capture_memory");
    t.notCalledTool("capture_source_record");
    t.notCalledTool("save_draft_to_gmail");
  },
});
