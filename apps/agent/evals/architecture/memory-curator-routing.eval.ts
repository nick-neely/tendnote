import { defineEval } from "eve/evals";

export default defineEval({
  description: "Architecture diagnostic: cleanup requests can route to Memory Curator.",
  tags: ["architecture", "memory-cleanup", "subagent"],
  async test(t) {
    await t.send("Use the memory curator to find stale, duplicate, or contradictory memories.");

    t.succeeded();
    t.calledSubagent("memory_curator", {
      output: /review|cleanup|memory|duplicate|stale|contradict/i,
    });
    t.notCalledTool("approve_suggested_memory");
    t.notCalledTool("dismiss_suggested_memory");
    t.notCalledTool("capture_memory");
    t.notCalledTool("capture_source_record");
  },
});
