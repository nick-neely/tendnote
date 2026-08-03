import { undoExplicitCaptureOutcome } from "@tendnote/db/queries/conversational-capture";
import { conversationalCaptureUndoTargetSchema } from "@tendnote/domain/conversational-capture";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";

export default defineTool({
  description:
    "Safely Undo a just-completed capture_saved_item operation when the user explicitly asks. Applies the returned authoritative inverse (archiving a new record or restoring the prior Context Fact value) while preserving source evidence. Use the exact undoTarget returned by Capture.",
  inputSchema: z.object({
    target: conversationalCaptureUndoTargetSchema.describe(
      "The exact undoTarget returned by capture_saved_item.",
    ),
  }),
  async execute(input, ctx) {
    const actorUserId = resolveOwnerUserId(ctx);
    const result = await undoExplicitCaptureOutcome({ actorUserId, ...input });
    if (result && typeof result === "object" && "affectedScopes" in result) {
      const affectedScopes = result.affectedScopes;
      if (Array.isArray(affectedScopes)) {
        await requestBackgroundAffectedScopeReconciliation(affectedScopes);
      }
    }
    return { target: input.target, undone: true };
  },
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        target: output.target,
        undone: true,
        guidance:
          "Confirm briefly that the captured destination record was authoritatively undone.",
      },
    };
  },
});
