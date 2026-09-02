import { includes } from "eve/evals/expect";
import { defineEval } from "../define-eval";
import { without } from "../expectations";

export default defineEval({
  description: "Cleanup Preview requests use the sandbox preview tool without durable writes.",
  tags: ["deterministic", "behavior", "cleanup-preview", "tool-choice"],
  async test(t) {
    await t.send(
      [
        "Preview this messy cleanup input before saving anything:",
        "name,email,phone,note",
        "Maya,maya@example.com,(555) 111-2222,Met at the design meetup",
        "Maya,MAYA@example.com,,duplicate row",
      ].join("\n"),
    );

    t.succeeded();
    t.calledTool("cleanup_preview");
    t.notCalledTool("create_person");
    t.notCalledTool("capture_memory");
    t.notCalledTool("capture_source_record");
    t.notCalledTool("create_followup");
    t.notCalledTool("propose_followup");
    t.notCalledTool("create_message_draft");
    // `cleanup_preview` writes nothing, and the skill requires Eve to say so plainly. The
    // old gate matched `/preview|save|saved/`, all supplied by the prompt itself.
    t.check(
      t.reply,
      includes(
        /nothing (is|has been|was|will be) saved|not saved|no records? (were|are)|before (anything|you) sav|only a preview/i,
      ),
    );
    t.check(
      t.reply,
      includes(
        without(
          "I(’|')?ve saved|I saved|I(’|')?ve added (maya|them|her|two)|I(’|')?ve created (a|the|two) (person|people|contact)",
        ),
      ),
    );
  },
});
