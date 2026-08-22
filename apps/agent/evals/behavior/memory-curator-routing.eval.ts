import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";
import { hasNoRuntimeFailures, without } from "../expectations";

export function memoryCleanupReplyMatchesCount(reply: string, count: number) {
  return count === 0
    ? /\b(?:nothing|none|no\s+(?:duplicates|stale|contradictions?|candidates?|proposals?))\b/i.test(
        reply,
      )
    : /\b(?:review|approv(?:e|al)|sign[ -]?off|go-ahead|consent|proposal|suggest)\b/i.test(reply);
}

export function curatorProposalCount(events: readonly unknown[]): number | null {
  const counts = events.flatMap((event) => {
    if (typeof event !== "object" || event === null) return [];
    const candidate = event as {
      type?: unknown;
      data?: { subagentName?: unknown; output?: unknown };
    };
    if (
      candidate.type !== "subagent.completed" ||
      candidate.data?.subagentName !== "memory_curator" ||
      typeof candidate.data.output !== "string"
    ) {
      return [];
    }
    const match = /^PROPOSAL_COUNT:\s*(\d+)\b/m.exec(candidate.data.output);
    return match?.[1] === undefined ? [] : [Number(match[1])];
  });
  return counts.length === 1 && Number.isSafeInteger(counts[0]) ? (counts[0] ?? null) : null;
}

export default defineEval({
  description: "Memory cleanup requests route to the review-only Memory Curator.",
  tags: ["deterministic", "behavior", "memory-cleanup", "subagent"],
  async test(t) {
    await t.send("Find stale, duplicate, or contradictory memories I should clean up.");

    let proposalCount: number | null = null;

    t.calledSubagent("memory_curator", {
      output: /PROPOSAL_COUNT:\s*\d+/i,
    });
    t.notCalledTool("approve_suggested_memory");
    t.notCalledTool("dismiss_suggested_memory");
    t.notCalledTool("capture_memory");
    t.notCalledTool("capture_source_record");
    t.notCalledTool("create_followup");
    t.notCalledTool("create_message_draft");
    t.eventsSatisfy("one completed curator reports its proposal count", (events) => {
      proposalCount = curatorProposalCount(events);
      return hasNoRuntimeFailures(events) && proposalCount !== null;
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
