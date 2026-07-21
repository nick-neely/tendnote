import { changeExplicitCaptureOutcome } from "@tendnote/db/queries/conversational-capture";
import {
  conversationalCaptureChangeTargetSchema,
  conversationalCaptureClarificationSchema,
  conversationalCaptureConfirmationSchema,
} from "@tendnote/domain/conversational-capture";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";

export default defineTool({
  description:
    "Change the wording of the destination record created by capture_saved_item when the user explicitly corrects that just-saved capture. Use the exact changeTarget returned by Capture.",
  inputSchema: z.object({
    clarificationAnswer: z.string().trim().min(1).max(500).optional(),
    originalText: z.string().trim().min(1).max(20_000),
    target: conversationalCaptureChangeTargetSchema.describe(
      "The exact changeTarget returned by capture_saved_item.",
    ),
  }),
  async execute(input, ctx) {
    const actorUserId = resolveOwnerUserId(ctx);
    const result = await changeExplicitCaptureOutcome({ actorUserId, ...input });
    const rawConfirmation =
      result && typeof result === "object" && "confirmation" in result
        ? result.confirmation
        : undefined;
    const parsedConfirmation = conversationalCaptureConfirmationSchema.safeParse(rawConfirmation);
    const confirmation = parsedConfirmation.success ? parsedConfirmation.data : undefined;
    const rawClarification =
      result && typeof result === "object" && "clarification" in result
        ? result.clarification
        : undefined;
    const parsedClarification =
      conversationalCaptureClarificationSchema.safeParse(rawClarification);
    const clarification = parsedClarification.success ? parsedClarification.data : undefined;
    return { changed: !clarification, clarification, confirmation, target: input.target };
  },
  toModelOutput(output) {
    if (output.clarification) {
      return {
        type: "json" as const,
        value: {
          changed: false,
          clarification: output.clarification.question,
          actions: output.clarification.actions,
          guidance:
            "Ask exactly this question and offer any returned person-resolution actions, then call this Change tool again with the same target and originalText plus clarificationAnswer.",
          target: output.target,
        },
      };
    }
    const confirmation = output.confirmation;
    const outcome = confirmation?.destination === "Grouped" ? undefined : confirmation;
    return {
      type: "json" as const,
      value: {
        changed: true,
        confirmation,
        target: outcome?.change ?? output.target,
        ...(outcome && "undo" in outcome ? { undoTarget: outcome.undo } : {}),
        guidance:
          "Confirm the corrected destination briefly. Use any returned replacement Change and Undo targets; do not repeat the full saved text.",
      },
    };
  },
});
