import { changeExplicitSavedItemCapture } from "@tendnote/db/queries/conversational-capture";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";

export default defineTool({
  description:
    "Change the wording of the private Saved Item created by capture_saved_item when the user explicitly corrects that just-saved capture.",
  inputSchema: z.object({
    originalText: z.string().trim().min(1).max(20_000),
    savedItemId: z.uuid().describe("The Saved Item id returned by capture_saved_item."),
  }),
  async execute(input, ctx) {
    const actorUserId = resolveOwnerUserId(ctx);
    const savedItem = await changeExplicitSavedItemCapture({ actorUserId, ...input });
    return {
      changed: true,
      savedItemId: savedItem.id,
      sourceRecordId: savedItem.sourceRecordId,
    };
  },
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        changed: true,
        savedItemId: output.savedItemId,
        guidance: "Confirm the change briefly. Do not repeat the full saved text.",
      },
    };
  },
});
