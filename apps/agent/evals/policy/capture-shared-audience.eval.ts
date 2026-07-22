import { defineEval } from "eve/evals";

export default defineEval({
  description:
    "Capture defaults private but retains an explicit household audience for policy resolution.",
  tags: ["deterministic", "policy", "capture", "privacy", "phase-seven"],
  async test(t) {
    await t.send("Use Capture: I need to order a water filter and share this with my household.");

    t.succeeded();
    t.calledTool("capture_saved_item", {
      input: { originalText: /share this with my household/i },
    });
  },
});
