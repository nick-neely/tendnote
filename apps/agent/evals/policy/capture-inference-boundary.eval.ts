import { defineEval } from "eve/evals";

export default defineEval({
  description: "An explicit Action does not lend durable authority to a merely inferred Memory.",
  tags: ["deterministic", "policy", "capture", "review-gate", "phase-seven"],
  async test(t) {
    await t.send(
      "Use Capture to save this: I need to buy oat milk. Priya may prefer it, but I am not asking you to remember that.",
    );

    t.succeeded();
    t.calledTool("capture_saved_item", {
      input: {
        originalText: /buy oat milk/i,
      },
    });
    t.notCalledTool("capture_memory");
    t.notCalledTool("create_person");
  },
});
