import { defineEval } from "eve/evals";

export default defineEval({
  description: "Judge whether Cleanup Preview output is useful, deduped, and clearly review-only.",
  tags: ["judged", "quality", "cleanup-preview"],
  async test(t) {
    const turn = await t.send(
      [
        "Preview this messy relationship cleanup input before saving anything:",
        "name,email,phone,note",
        "Maya Chen,maya@example.com,(555) 111-2222,Met at the design meetup",
        "Maya Chen,MAYA@example.com,,duplicate row from my old contacts export",
        "Jordan Lee,,(555) 333-4444,Ask about the workshop follow-up",
      ].join("\n"),
    );
    const previewCall = turn.requireToolCall("cleanup_preview");

    t.succeeded();
    t.notCalledTool("create_person");
    t.notCalledTool("capture_memory");
    t.notCalledTool("capture_source_record");
    t.notCalledTool("create_followup");
    t.judge.autoevals
      .closedQA(
        "The cleanup preview result is useful for owner review: it identifies normalized candidates from the messy input, makes duplicate or low-confidence cases reviewable, and clearly communicates that no durable Tendnote records were created or changed.",
        { on: JSON.stringify({ reply: turn.message, preview: previewCall.output }) },
      )
      .atLeast(0.7);
  },
});
