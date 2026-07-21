import { defineEval } from "eve/evals";

export default defineEval({
  description:
    "A correction request targets one grouped Capture outcome through its returned Change control.",
  tags: ["deterministic", "behavior", "capture", "correction", "phase-seven"],
  async test(t) {
    await t.send(
      "Use Capture for both explicit clauses: save a note that the filter is noisy; I need to order a replacement. Then change only the Saved Item outcome to say the filter rattles.",
    );

    t.succeeded();
    t.calledTool("capture_saved_item", { input: { originalText: /filter is noisy.*order/is } });
    t.calledTool("change_saved_item_capture");
  },
});
