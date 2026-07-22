import { defineEval } from "eve/evals";

export default defineEval({
  description: "A named-person reminder uses Capture and never creates a Person by mention alone.",
  tags: ["deterministic", "behavior", "capture", "people", "clarification", "phase-seven"],
  async test(t) {
    await t.send("Use Capture: remind me to follow up with Sam tomorrow.");

    t.succeeded();
    t.calledTool("capture_saved_item", { input: { originalText: /follow up with Sam/i } });
    t.notCalledTool("create_person");
  },
});
