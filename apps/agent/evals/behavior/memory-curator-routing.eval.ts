import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";
import { hasNoRuntimeFailures, without } from "../expectations";

const CLEANUP_TERMS =
  "cleanup|duplicates?|stale|contradictions?|contradictory(?:\\s+memories?)?|candidates?|proposals?|suggestions?";

export function memoryCleanupReplyMatchesCount(reply: string, count: number) {
  if (count === 0) {
    const reportsNoCleanup =
      /\b(?:nothing|none)\b/i.test(reply) ||
      new RegExp(`\\b(?:no|zero)\\b[\\s\\S]{0,70}\\b(?:${CLEANUP_TERMS})\\b`, "i").test(reply);
    return reportsNoCleanup && !hasPositiveCleanupClaim(reply);
  }

  return (
    hasPositiveCleanupClaim(reply) &&
    /\b(?:review|approv(?:e|al)|sign[ -]?off|go-ahead|consent|proposal|suggest)\b/i.test(reply)
  );
}

function hasPositiveCleanupClaim(reply: string): boolean {
  const quantity = new RegExp(
    `\\b(?:\\d+|one|two|three|some|several|a|an)\\s+(?:cleanup\\s+)?(?:${CLEANUP_TERMS})\\b`,
    "i",
  );
  const firstPerson = new RegExp(
    `\\b(?:I|we)\\s+(?:found|identified|flagged|have|has|see|noted)\\s+(?![\\s\\S]{0,30}\\b(?:no|none|nothing|zero)\\b)[\\s\\S]{0,60}\\b(?:${CLEANUP_TERMS})\\b`,
    "i",
  );
  const existential = new RegExp(
    `\\bthere\\s+(?:is|are)\\s+(?![\\s\\S]{0,30}\\b(?:no|none|nothing|zero)\\b)[\\s\\S]{0,60}\\b(?:${CLEANUP_TERMS})\\b`,
    "i",
  );
  const describedMemory =
    /\b(?:\d+|one|two|three|some|several|a|an)\s+memor(?:y|ies)\s+(?:(?:is|are)\s+)?(?:stale|duplicates?|contradictory)\b/i;
  return (
    quantity.test(reply) ||
    firstPerson.test(reply) ||
    existential.test(reply) ||
    describedMemory.test(reply) ||
    hasUnnegatedCleanupRemain(reply)
  );
}

function hasUnnegatedCleanupRemain(reply: string): boolean {
  const remaining =
    /\b(?:cleanup\s+)?(?:proposals?|suggestions?|candidates?)\s+remain(?:s|ed)?\b/gi;
  for (const match of reply.matchAll(remaining)) {
    const start = match.index ?? 0;
    const clauseStart = Math.max(
      reply.lastIndexOf(",", start),
      reply.lastIndexOf(";", start),
      reply.lastIndexOf(".", start),
      reply.lastIndexOf("\n", start),
    );
    const clausePrefix = reply.slice(clauseStart + 1, start);
    if (!/\b(?:no|none|nothing|zero)\b/i.test(clausePrefix)) return true;
  }
  return false;
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
