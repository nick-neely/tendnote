import { captureExplicitSavedItem } from "@tendnote/db/queries/conversational-capture";
import { conversationalCaptureInputModeSchema } from "@tendnote/domain/conversational-capture";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";

const inputSchema = z.object({
  interactionId: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("A stable id for this user save request. Reuse it only when retrying the same turn."),
  inputMode: conversationalCaptureInputModeSchema
    .default("typed")
    .describe("Whether the retained text was typed or transcribed from dictation."),
  originalText: z
    .string()
    .trim()
    .min(1)
    .max(20_000)
    .describe("The user's meaningful original wording to retain as source evidence."),
});

export default defineTool({
  description:
    "Explicitly save a private general note, link, or open question when the user directly asks Tendnote to save, remember, note, or keep it. Do not call this for ordinary questions or inferred outcomes. Person facts still use capture_memory.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const result = await captureExplicitSavedItem({
      authority: "explicit",
      interactionId: input.interactionId,
      inputMode: input.inputMode,
      originalText: input.originalText,
      ownerUserId,
      surface: "eve",
    });

    return {
      savedItem: {
        id: result.savedItem.id,
        kind: result.savedItem.kind,
        scope: result.savedItem.scope,
        sourceRecordId: result.savedItem.sourceRecordId,
      },
      confirmation: result.confirmation,
    };
  },
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        saved: true,
        savedItemId: output.savedItem.id,
        changeTool: "change_saved_item_capture",
        destination: output.confirmation.destination,
        savedAs: output.confirmation.interpreted.kind,
        visibleTo: output.confirmation.interpreted.visibility,
        groundedInOriginalCapture: true,
        undoTool: "undo_saved_item_capture",
        guidance:
          "Confirm briefly with destination, saved-as kind, Only me visibility, source grounding, and offer Change or Undo. Do not repeat the full saved text.",
      },
    };
  },
});
