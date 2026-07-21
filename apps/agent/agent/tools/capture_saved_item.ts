import { captureExplicitOutcome } from "@tendnote/db/queries/conversational-capture";
import { conversationalCaptureInputModeSchema } from "@tendnote/domain/conversational-capture";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";

const inputSchema = z.object({
  clarificationAnswer: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .optional()
    .describe("The user's answer to the one clarification returned for this same interaction."),
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
    "Route one explicit private Capture into a Saved Item, Action, Routine, or person Follow-Up. Reuse the interaction id and original text when answering its focused clarification. Never call this for ordinary questions or inferred outcomes. Person facts still use capture_memory.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const result = await captureExplicitOutcome({
      authority: "explicit",
      ...(input.clarificationAnswer ? { clarificationAnswer: input.clarificationAnswer } : {}),
      interactionId: input.interactionId,
      inputMode: input.inputMode,
      originalText: input.originalText,
      ownerUserId,
      surface: "eve",
    });

    if (result.clarification) {
      return { clarification: result.clarification };
    }
    return { confirmation: result.confirmation };
  },
  toModelOutput(output) {
    if (output.clarification) {
      return {
        type: "json" as const,
        value: {
          savedSourceEvidence: true,
          clarification: output.clarification.question,
          actions: output.clarification.actions,
          guidance:
            "Ask exactly this one focused question. Offer any returned Add person and Link someone else actions; use the existing person tools only after the owner explicitly chooses one. Then call this tool again with the same interactionId and originalText plus clarificationAnswer.",
        },
      };
    }
    if (!output.confirmation) {
      throw new Error("Capture returned neither a clarification nor a confirmation.");
    }
    const confirmation = output.confirmation;
    return {
      type: "json" as const,
      value: {
        saved: true,
        changeTool: "change_saved_item_capture",
        changeTarget: confirmation.change,
        destination: confirmation.destination,
        interpreted: confirmation.interpreted,
        visibleTo: "Only me",
        groundedInOriginalCapture: true,
        undoTool: "undo_saved_item_capture",
        undoTarget: confirmation.undo,
        guidance:
          "Confirm briefly with destination, relevant due/cadence/person details, Only me visibility, source grounding, and offer Change or Undo. Do not repeat the full saved text.",
      },
    };
  },
});
