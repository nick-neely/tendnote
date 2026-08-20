import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";
import { toolOutputs, without } from "../expectations";

export function memoryCleanupReplyMatchesCount(reply: string, count: number) {
  return count === 0
    ? /\b(?:nothing|none|no\s+(?:duplicates|stale|contradictions?|candidates?|proposals?))\b/i.test(
        reply,
      )
    : /\b(?:review|approv(?:e|al)|sign[ -]?off|go-ahead|consent|proposal|suggest)\b/i.test(reply);
}

export default defineEval({
  description: "Memory cleanup requests route to the review-only Memory Curator.",
  tags: ["deterministic", "behavior", "memory-cleanup", "subagent"],
  async test(t) {
    await t.send("Find stale, duplicate, or contradictory memories I should clean up.");

    let proposalCount: number | null = null;

    t.succeeded();
    t.calledSubagent("memory_curator", {
      output: /review|cleanup|memor(y|ies)/i,
    });
    t.notCalledTool("approve_suggested_memory");
    t.notCalledTool("dismiss_suggested_memory");
    t.notCalledTool("capture_memory");
    t.notCalledTool("capture_source_record");
    t.notCalledTool("create_followup");
    t.notCalledTool("create_message_draft");
    t.eventsSatisfy("the reply follows the actual cleanup proposal count", (events) => {
      const outputs = toolOutputs(events, "propose_memory_cleanup");
      if (outputs.length !== 1) return false;
      const output = outputs[0];
      if (typeof output !== "object" || output === null) return false;
      const proposals = (output as { proposals?: unknown }).proposals;
      if (!Array.isArray(proposals)) return false;
      proposalCount = proposals.length;
      return true;
    });
    t.check(
      t.reply,
      satisfies(
        (reply) =>
          typeof reply === "string" &&
          proposalCount !== null &&
          memoryCleanupReplyMatchesCount(reply, proposalCount),
        "empty cleanup says none; proposals remain review-gated",
      ),
    );
    t.check(
      t.reply,
      includes(
        without(
          "I(’|')?ve (archived|deleted|removed|merged|cleaned|tidied)|I (archived|deleted|removed|merged) (it|them|the)|(archived|deleted|merged) \\d+",
        ),
      ),
    );
  },
});
