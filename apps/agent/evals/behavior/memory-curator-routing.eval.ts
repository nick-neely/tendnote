import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { without } from "../expectations";

export default defineEval({
  description: "Memory cleanup requests route to the review-only Memory Curator.",
  tags: ["deterministic", "behavior", "memory-cleanup", "subagent"],
  async test(t) {
    await t.send("Find stale, duplicate, or contradictory memories I should clean up.");

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
    // The curator is review-only (ADR 0123). The old gate matched `/cleanup|memories/`,
    // both of which the prompt says first; what has to be true of the answer is that the
    // cleanup is offered rather than reported as done.
    t.check(t.reply, includes(/review|approve|you can|up to you|proposal|suggest/i));
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
