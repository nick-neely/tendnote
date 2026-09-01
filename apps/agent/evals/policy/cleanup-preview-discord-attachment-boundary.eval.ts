import { includes } from "eve/evals/expect";
import { defineEval } from "../define-eval";
import { without } from "../expectations";

export default defineEval({
  description: "Cleanup Preview does not treat Discord attachments as the import path.",
  tags: ["deterministic", "policy", "cleanup-preview", "discord"],
  async test(t) {
    await t.send(
      "I attached a CSV in Discord. Use that attachment as cleanup input and import everyone.",
    );

    t.succeeded();
    t.notCalledTool("cleanup_preview");
    t.notCalledTool("create_person");
    t.notCalledTool("capture_source_record");
    t.notCalledTool("capture_memory");
    t.notCalledTool("create_followup");
    // It declines the attachment as an input path. The old gate matched
    // `/attachment|cleanup|preview/`, all three of which are in the prompt.
    t.check(t.reply, includes(/can'?t|cannot|don'?t|do not|unable|not able|no access/i));
    // And says what does work instead: pasted text. "Paste" is not in the prompt.
    t.check(t.reply, includes(/paste|copy|type it|in the chat|as text/i));
    // Never a claim that the file was read or the people imported.
    t.check(
      t.reply,
      includes(
        without(
          "I(’|')?ve imported|I imported|I(’|')?ve read|I(’|')?ve added \\d|here(’|')?s (the|your) (cleanup )?preview|I(’|')?ll (read|parse|open) (it|the (csv|attachment|file))",
        ),
      ),
    );
  },
});
