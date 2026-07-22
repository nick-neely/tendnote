import { undoExplicitCaptureOutcome } from "@tendnote/db/queries/conversational-capture";
import { conversationalCaptureUndoTargetSchema } from "@tendnote/domain/conversational-capture";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";

export default defineTool({
  description:
    "Safely Undo a just-completed capture_saved_item operation when the user explicitly asks. Archives its real destination record while preserving source evidence. Use the exact undoTarget returned by Capture.",
  inputSchema: z.object({
    target: conversationalCaptureUndoTargetSchema.describe(
      "The exact undoTarget returned by capture_saved_item.",
    ),
  }),
  async execute(input, ctx) {
    const actorUserId = resolveOwnerUserId(ctx);
    await undoExplicitCaptureOutcome({ actorUserId, ...input });
    return { target: input.target, undone: true };
  },
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        target: output.target,
        undone: true,
        guidance: "Confirm briefly that the captured destination record was archived.",
      },
    };
  },
});
