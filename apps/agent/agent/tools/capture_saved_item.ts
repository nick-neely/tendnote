import { captureExplicitOutcome } from "@tendnote/db/queries/conversational-capture";
import {
  conversationalCaptureInferredSuggestionSchema,
  conversationalCaptureInputModeSchema,
  conversationalCaptureRequestedScopeSchema,
} from "@tendnote/domain/conversational-capture";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

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
  requestedScope: conversationalCaptureRequestedScopeSchema
    .optional()
    .describe(
      "Set to 'household' ONLY when the user has deliberately said this capture is for the " +
        "household in this same turn — 'save this for our household', 'this one is shared'. " +
        "Never set it because they said 'we', named a housemate, mentioned something domestic, " +
        "or shared something earlier in the conversation. If save intent is clear but the " +
        "subject is genuinely ambiguous, ask whether it is about them or the household rather " +
        "than choosing. Omitting it keeps the capture private, which is the correct default.",
    ),
});

export default defineTool({
  description:
    "GLOBAL CAPTURE PRECEDENCE: when the user explicitly says 'Use Capture' or 'capture this', call this tool exactly once with their meaningful original wording. If the user's message contains two or more supported explicit clauses, call capture_saved_item exactly once before any destination-specific tool, even when the word Capture never appears. Do not ask which destination to use before calling capture_saved_item; the shared router owns grouping and can return a focused clarification. Do not fan that request out to create_person, capture_memory, search_assets, or propose_asset_memories. Route it into supported Saved Item, Action, Routine, Follow-Up, Person, approved Memory, Asset Review, or private Self Context outcomes. Capture is private by default. Pass requestedScope: 'household' only when the user deliberately says this one is for the household in the same turn — never from 'we', a housemate's name, a domestic topic, or something they shared earlier. Otherwise preserve an explicit 'share with household/member' suffix verbatim for server-side audience resolution. Multiple clauses are grouped only when the user explicitly requests each one. Reuse the interaction id and original text when answering its focused clarification. Never call this for ordinary questions or inferred outcomes.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const result = await withModelSafeStoreErrors(() =>
      captureExplicitOutcome({
        authority: "explicit",
        ...(input.clarificationAnswer ? { clarificationAnswer: input.clarificationAnswer } : {}),
        interactionId: input.interactionId,
        inputMode: input.inputMode,
        ...(input.inferredSuggestions ? { inferredSuggestions: input.inferredSuggestions } : {}),
        originalText: input.originalText,
        // The word only. The household it resolves to is read from this caller's
        // own active memberships inside the seam, so no model turn can name a
        // workspace or widen an audience (ADR 0219).
        ...(input.requestedScope ? { requestedScope: input.requestedScope } : {}),
        ownerUserId,
        surface: "eve",
      }),
    );
    await requestBackgroundAffectedScopeReconciliation(result.affectedScopes ?? []);

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
        rendered: "The capture outcome is shown to the user in a card.",
        guidance:
          "Confirm the compact outcome list once, including each returned audience and source grounding. Offer each outcome's own Change and, when returned, Undo control. Do not repeat the full saved text.",
      },
    };
  },
});
