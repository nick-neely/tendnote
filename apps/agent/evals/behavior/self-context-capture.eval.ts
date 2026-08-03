import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
  description:
    "An explicit Global Capture self-fact uses the shared Capture entry point and can resolve to private Self Context.",
  tags: ["deterministic", "behavior", "self-context", "capture", "phase-seven-point-five"],
  async test(t) {
    await t.send("Use Capture to save this about me: I run a small software consultancy.");

    t.succeeded();
    t.calledTool("capture_saved_item", {
      input: { originalText: /I run a small software consultancy/i },
    });
    t.notCalledTool("remember_self_context");
    t.notCalledTool("capture_memory");
    t.check(t.reply, includes(/capture|self context|saved/i));
  },
});
