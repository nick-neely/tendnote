import { defineEval } from "eve/evals";
import { toolOutputs, without } from "../expectations";

export default defineEval({
  description:
    "An explicit fact about the authenticated owner uses the direct Self Context lifecycle, not review-gated Capture.",
  tags: ["deterministic", "behavior", "self-context", "direct-write", "phase-seven-point-five"],
  async test(t) {
    const first = await t.send(
      "Remember that I run a small software consultancy. Save this about me.",
    );

    first.expectOk();
    first.calledTool("remember_self_context");
    first.notCalledTool("capture_saved_item");
    first.notCalledTool("capture_memory");

    // A second explicit request proves the idempotent branch instead of merely
    // proving that a fresh fact can be created. It must still reach the direct
    // write seam when the equivalent active fact already exists.
    const repeated = await t.send(
      "Please remember that same fact again: I run a small software consultancy. Save this about me.",
    );

    t.succeeded();
    repeated.expectOk();
    repeated.calledTool("remember_self_context");
    repeated.notCalledTool("capture_saved_item");
    repeated.notCalledTool("capture_memory");
    repeated.notCalledTool("list_self_context");
    repeated.notCalledTool("get_self_context_fact");
    repeated.eventsSatisfy("the repeated direct write reuses the existing fact", (events) =>
      toolOutputs(events, "remember_self_context").some((output) => {
        if (typeof output !== "object" || output === null) return false;
        const candidate = output as {
          decision?: unknown;
          created?: unknown;
          reusedExisting?: unknown;
        };
        return (
          candidate.decision === "existing" &&
          candidate.created === false &&
          candidate.reusedExisting === true
        );
      }),
    );
    // `remember_self_context` writes an active fact directly. The old gate echoed the
    // prompt ("Remember...", "Save this"); what matters is that the answer does not
    // describe the direct write as something queued for review.
    repeated.messageIncludes(
      without("for (your )?review|review queue|suggest(ed|ion)|waiting for|once you approve"),
    );
  },
});
