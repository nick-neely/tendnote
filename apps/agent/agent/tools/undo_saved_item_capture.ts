import { undoExplicitSavedItemCapture } from "@tendnote/db/queries/conversational-capture";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";

export default defineTool({
  description:
    "Safely Undo a just-completed capture_saved_item operation when the user explicitly asks to undo it. Archives the Saved Item while preserving source evidence.",
  inputSchema: z.object({
    savedItemId: z.uuid().describe("The Saved Item id returned by capture_saved_item."),
  }),
  async execute(input, ctx) {
    const actorUserId = resolveOwnerUserId(ctx);
    const savedItem = await undoExplicitSavedItemCapture({ actorUserId, ...input });
    return { savedItemId: savedItem.id, status: savedItem.status, undone: true };
  },
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        savedItemId: output.savedItemId,
        undone: true,
        guidance: "Confirm briefly that the Saved Item was archived.",
      },
    };
  },
});
