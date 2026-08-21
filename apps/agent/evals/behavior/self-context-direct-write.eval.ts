import { defineEval } from "eve/evals";
import { toolOutputs, without } from "../expectations";

const ALTERNATE_SELF_CONTEXT_WRITES = [
  "capture_saved_item",
  "capture_memory",
  "capture_source_record",
  "propose_suggested_memory",
  "approve_suggested_memory",
  "dismiss_suggested_memory",
  "archive_memory",
  "update_self_context",
  "archive_self_context",
  "restore_self_context",
] as const;

export default defineEval({
  description:
    "An explicit fact about the authenticated owner uses the direct Self Context lifecycle, not review-gated Capture.",
  tags: ["deterministic", "behavior", "self-context", "direct-write", "phase-seven-point-five"],
  async test(t) {
    const first = await t.send(
      "Remember that I volunteer at the community garden every Saturday. Save this about me.",
    );

    first.expectOk();
    first.calledTool("remember_self_context", { count: 1 });
    for (const tool of ALTERNATE_SELF_CONTEXT_WRITES) {
      first.notCalledTool(tool);
    }
    first.eventsSatisfy("the first direct write creates the fact", (events) =>
      toolOutputs(events, "remember_self_context").some((output) => {
        if (typeof output !== "object" || output === null) return false;
        const candidate = output as {
          decision?: unknown;
          created?: unknown;
          reusedExisting?: unknown;
        };
        return (
          candidate.decision === "created" &&
          candidate.created === true &&
          candidate.reusedExisting === false
        );
      }),
    );

    // A second explicit request proves the idempotent branch instead of merely
    // proving that a fresh fact can be created. It must still reach the direct
    // write seam when the equivalent active fact already exists.
    const repeated = await t.send(
      "Please remember that same fact again: I volunteer at the community garden every Saturday. Save this about me.",
    );

    t.succeeded();
    repeated.expectOk();
    repeated.calledTool("remember_self_context", { count: 1 });
    repeated.notCalledTool("list_self_context");
    repeated.notCalledTool("get_self_context_fact");
    for (const tool of ALTERNATE_SELF_CONTEXT_WRITES) {
      repeated.notCalledTool(tool);
    }
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
