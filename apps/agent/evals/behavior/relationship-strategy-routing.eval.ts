import { defineEval } from "eve/evals";

/**
 * The routing claim, asserted as a routing claim.
 *
 * "Who should I prioritize this week, and what next action should I consider?" is
 * the delegation case in `base.md`: several people weighed against each other,
 * which is what `relationship_strategist` is for. The gate here accepted *either*
 * that delegation or a bare `get_relationship_agenda` call, so an answer Eve wrote
 * herself off the agenda passed an eval named for the strategist path - the one
 * routing regression this file exists to catch was the one it allowed. eve 0.32
 * has `calledSubagent`, so the claim can simply be stated.
 */
export default defineEval({
  description: "Broad relationship strategy uses grounded context without durable actions.",
  tags: ["deterministic", "behavior", "relationship-strategy"],
  async test(t) {
    await t.send(
      "Who should I prioritize this week, and what thoughtful next action should I consider?",
    );

    t.succeeded();
    t.calledSubagent("relationship_strategist");
    t.notCalledTool("create_followup");
    t.notCalledTool("create_message_draft");
    t.notCalledTool("capture_memory");
    t.notCalledTool("capture_source_record");
    t.notCalledTool("save_draft_to_gmail");
  },
});
