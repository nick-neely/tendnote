import { defineEval } from "../define-eval";
import { usedRelationshipStrategyPath } from "../helpers";

/**
 * The routing claim, asserted as a routing claim.
 *
 * "Who should I prioritize this week, and what next action should I consider?" is
 * a broad, lightweight summary. The authored contract permits root Eve to answer
 * that from the read-only `get_relationship_agenda`; deeper synthesis may delegate
 * to `relationship_strategist`. The gate therefore accepts either grounded path,
 * while the mutation bans remain hard.
 */
export default defineEval({
  description: "Broad relationship strategy uses grounded context without durable actions.",
  tags: ["deterministic", "behavior", "relationship-strategy"],
  timeoutMs: 120_000,
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
