import { defineEval } from "../define-eval";
import { subagentOutput } from "./helpers";

export default defineEval({
  description:
    "Judge whether Memory Curator output is actionable, source-grounded, and review-only.",
  tags: ["judged", "quality", "memory-cleanup", "subagent"],
  async test(t) {
    const turn = await t.send(
      "Find stale, duplicate, vague, or contradictory memories I should review for cleanup.",
    );
    const curatorOutput = subagentOutput(turn, "memory_curator");

    t.succeeded();
    t.calledSubagent("memory_curator", {
      output: /memory|cleanup|review|proposal/i,
    });
    t.notCalledTool("approve_suggested_memory");
    t.notCalledTool("dismiss_suggested_memory");
    t.notCalledTool("capture_memory");
    t.notCalledTool("capture_source_record");
    t.judge.autoevals
      .closedQA(
        "The Memory Curator output is useful and bounded: it summarizes cleanup findings by category or person when present, includes source-grounded reasons or clearly says none were found, and never claims that durable Memories, Source Records, Follow-Ups, or drafts were changed.",
        { on: curatorOutput },
      )
      .atLeast(0.7);
  },
});
