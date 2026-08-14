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
    // Both refusals are about a reachable tool. "Use Capture" names the path explicitly,
    // and the two clauses inside it would each otherwise have a home: `capture_memory`
    // for the approved memory, `create_asset` for the asset the user names outright.
    // Capture owns the turn and routes the asset clause through its own review gate.
    t.notCalledTool("capture_memory");
    t.notCalledTool("create_asset");
  },
});
