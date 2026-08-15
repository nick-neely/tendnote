import { defineEval } from "eve/evals";

/**
 * The audience half of Capture, which this eval named and never checked.
 *
 * It asserted only that the household suffix survived into `originalText` - true
 * of any capture that echoed the sentence, and equally true of one that filed the
 * item privately. `requestedScope` is the field that carries the audience, and
 * its documented trigger is exactly this sentence: the user deliberately saying,
 * in this same turn, that this one is for the household. Both halves are asserted
 * because they fail differently - a missing scope files a shared item privately,
 * and a rewritten `originalText` loses the evidence the server resolves against.
 *
 * The default is the other half of the claim, and it is guarded by the six
 * `behavior/capture-precedence` cases: none of them says "household", and none of
 * them may carry a scope.
 */
export default defineEval({
  description:
    "Capture defaults private but retains an explicit household audience for policy resolution.",
  tags: ["deterministic", "policy", "capture", "privacy", "phase-seven"],
  async test(t) {
    await t.send("Use Capture: I need to order a water filter and share this with my household.");

    t.succeeded();
    t.calledTool("capture_saved_item", {
      input: {
        originalText: /share this with my household/i,
        requestedScope: "household",
      },
      count: 1,
    });
  },
});
