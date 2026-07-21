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
    t.notCalledTool("create_person");
    t.notCalledTool("capture_memory");
    t.notCalledTool("create_asset");
  },
});
