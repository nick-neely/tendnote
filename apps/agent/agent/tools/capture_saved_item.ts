import { captureExplicitOutcome } from "@tendnote/db/queries/conversational-capture";
import {
  conversationalCaptureInferredSuggestionSchema,
  conversationalCaptureInputModeSchema,
} from "@tendnote/domain/conversational-capture";
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
  inferredSuggestions: z
    .array(conversationalCaptureInferredSuggestionSchema)
    .max(4)
    .optional()
    .describe(
      "Optional secondary interpretations. They are always persisted as private review artifacts, never approved records, and must not duplicate an explicit clause.",
    ),
  originalText: z
    .string()
    .trim()
    .min(1)
    .max(20_000)
    .describe("The user's meaningful original wording to retain as source evidence."),
});

export default defineTool({
  description:
    "GLOBAL CAPTURE PRECEDENCE: when the user explicitly says 'Use Capture' or 'capture this', call this tool exactly once with their meaningful original wording. A turn containing two or more supported explicit clauses is also automatically Global Capture even if the word Capture never appears. Do not fan that request out to create_person, capture_memory, search_assets, or propose_asset_memories. Route it into supported Saved Item, Action, Routine, Follow-Up, Person, approved Memory, or Asset Review outcomes. Capture is private by default; preserve an explicit 'share with household/member' suffix for server-side audience resolution. Multiple clauses are grouped only when the user explicitly requests each one. Reuse the interaction id and original text when answering its focused clarification. Never call this for ordinary questions or inferred outcomes.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const result = await captureExplicitOutcome({
      authority: "explicit",
      ...(input.clarificationAnswer ? { clarificationAnswer: input.clarificationAnswer } : {}),
      interactionId: input.interactionId,
      inputMode: input.inputMode,
      ...(input.inferredSuggestions ? { inferredSuggestions: input.inferredSuggestions } : {}),
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
    const outcomes =
      confirmation.destination === "Grouped" ? confirmation.outcomes : [confirmation];
    const visibleTo = [
      ...new Set(
        outcomes.map((outcome) =>
          outcome.destination === "Saved Items"
            ? outcome.interpreted.visibility
            : outcome.interpreted.scope,
        ),
      ),
    ];
    return {
      type: "json" as const,
      value: {
        saved: true,
        changeTool: "change_saved_item_capture",
        changeTargets: outcomes.map((outcome) => outcome.change),
        destination: confirmation.destination,
        outcomes: outcomes.map((outcome) => ({
          destination: outcome.destination,
          interpreted: outcome.interpreted,
          changeTarget: outcome.change,
          ...("undo" in outcome ? { undoTarget: outcome.undo } : {}),
        })),
        visibleTo,
        groundedInOriginalCapture: true,
        undoTool: "undo_saved_item_capture",
        guidance:
          "Confirm the compact outcome list once, including each returned audience and source grounding. Offer each outcome's own Change and, when returned, Undo control. Do not repeat the full saved text.",
      },
    };
  },
});
