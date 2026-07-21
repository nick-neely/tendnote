import { defineEval } from "eve/evals";

export default defineEval({
  description:
    "Explicit Add Person intent goes through source-grounded Capture, not a side-channel write.",
  tags: ["deterministic", "behavior", "capture", "people", "phase-seven"],
  async test(t) {
    await t.send("Use Capture to add Priya.");

    t.succeeded();
    t.calledTool("capture_saved_item", { input: { originalText: /add Priya/i } });
    t.notCalledTool("create_person");
  },
});
