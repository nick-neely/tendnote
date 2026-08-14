import { defineEval } from "eve/evals";

export default defineEval({
  description:
    "Independently explicit cross-domain clauses use one grouped Capture without side-channel writes.",
  tags: ["deterministic", "behavior", "capture", "phase-seven"],
  async test(t) {
    await t.send(
      "Add Priya; remember that Priya prefers oat milk; and track asset refrigerator water filter: model EDR4RXD1.",
    );

    t.succeeded();
    t.calledTool("capture_saved_item", {
      input: {
        originalText: /Add Priya.*remember.*track asset/is,
      },
    });
    // Each clause has a tool that could plausibly serve it, and Capture's precedence is
    // that none of them does when the clauses arrive together. `create_asset` is the
    // sharpest of the three now that it exists: "track asset refrigerator water filter"
    // IS an explicit asset instruction, so the assertion is no longer about a tool the
    // model could not reach - it is about a tool it could reach and must not, because
    // `capture_saved_item` owns a multi-clause turn and produces the review-gated Asset
    // outcome itself.
    t.notCalledTool("create_person");
    t.notCalledTool("capture_memory");
    t.notCalledTool("create_asset");
  },
});
