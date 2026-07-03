import { defineEval } from "eve/evals";
import { usedRelationshipStrategyPath } from "../helpers";

export default defineEval({
  description: "Broad relationship strategy uses grounded context without durable actions.",
  tags: ["deterministic", "behavior", "relationship-strategy"],
  async test(t) {
    await t.send(
      "Who should I prioritize this week, and what thoughtful next action should I consider?",
    );

    t.succeeded();
    t.eventsSatisfy("uses direct agenda grounding or the relationship strategist", (events) =>
      usedRelationshipStrategyPath(events),
    );
    t.notCalledTool("create_followup");
    t.notCalledTool("create_message_draft");
    t.notCalledTool("capture_memory");
    t.notCalledTool("capture_source_record");
    t.notCalledTool("save_draft_to_gmail");
  },
});
