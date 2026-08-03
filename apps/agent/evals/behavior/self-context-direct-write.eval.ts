import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

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
    t.check(t.reply, includes(/remember|saved|stored|self context/i));
  },
});
