import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { without } from "../expectations";

export default defineEval({
  description:
    "An explicit fact about the authenticated owner uses the direct Self Context lifecycle, not review-gated Capture.",
  tags: ["deterministic", "behavior", "self-context", "direct-write", "phase-seven-point-five"],
  async test(t) {
    await t.send("Remember that I run a small software consultancy. Save this about me.");

    t.succeeded();
    t.calledTool("remember_self_context");
    t.notCalledTool("capture_saved_item");
    t.notCalledTool("capture_memory");
    // `remember_self_context` writes an active fact directly. The old gate echoed the
    // prompt ("Remember...", "Save this"); what matters is that the answer does not
    // describe the direct write as something queued for review.
    t.check(
      t.reply,
      includes(
        without("for (your )?review|review queue|suggest(ed|ion)|waiting for|once you approve"),
      ),
    );
  },
});
