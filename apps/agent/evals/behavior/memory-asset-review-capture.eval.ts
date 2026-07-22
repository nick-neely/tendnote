import { defineEval } from "eve/evals";

export default defineEval({
  description:
    "Explicit Memory and Asset facts enter their approved and review-gated Capture seams.",
  tags: ["deterministic", "behavior", "capture", "memory", "assets", "phase-seven"],
  async test(t) {
    await t.send(
      "Use Capture: remember that Priya prefers oat milk; track asset refrigerator filter: model EDR4RXD1.",
    );

    t.succeeded();
    t.calledTool("capture_saved_item", {
      input: { originalText: /remember.*track asset/is },
    });
    t.notCalledTool("capture_memory");
    t.notCalledTool("create_asset");
  },
});
