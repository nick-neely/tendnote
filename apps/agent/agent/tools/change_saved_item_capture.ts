import { changeExplicitCaptureOutcome } from "@tendnote/db/queries/conversational-capture";
import {
  conversationalCaptureChangeTargetSchema,
  conversationalCaptureClarificationSchema,
  conversationalCaptureConfirmationSchema,
} from "@tendnote/domain/conversational-capture";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireOwnerApproval } from "../lib/approval";
import { describeRegisteredSubject } from "../lib/approval/subject-registry";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

/**
 * What the shared correction can hand back.
 *
 * Exactly one of these is true of every completed call: it asked one focused
 * question and wrote nothing, or it applied the correction and described it. The
 * tool used to compute `changed: !clarification`, which made a *failed* parse of
 * either field indistinguishable from a successful change — so a correction that
 * never landed was reported to the model as done.
 */
type ChangeResult =
  | { changed: false; clarification: ChangeClarification; target: ChangeTarget }
  | { changed: true; confirmation: ChangeConfirmation | null; target: ChangeTarget };

type ChangeTarget = z.infer<typeof conversationalCaptureChangeTargetSchema>;
type ChangeClarification = z.infer<typeof conversationalCaptureClarificationSchema>;
type ChangeConfirmation = z.infer<typeof conversationalCaptureConfirmationSchema>;

/** Reads one field off the shared correction's loosely-typed result. */
function field(result: unknown, name: "clarification" | "confirmation"): unknown {
  return result && typeof result === "object" && name in result
    ? (result as Record<string, unknown>)[name]
    : undefined;
}

export default defineTool({
  approval: requireOwnerApproval({ describe: describeRegisteredSubject() }),
  description:
    "Change the wording of the destination record created by capture_saved_item when the user explicitly corrects that just-saved capture. Use the exact changeTarget returned by Capture. This call pauses for the user's approval; if they cancel, say it did not happen and do not retry it or route around it.",
  inputSchema: z.object({
    clarificationAnswer: z.string().trim().min(1).max(500).optional(),
    originalText: z.string().trim().min(1).max(20_000),
    target: conversationalCaptureChangeTargetSchema.describe(
      "The exact changeTarget returned by capture_saved_item.",
    ),
  }),
  async execute(input, ctx): Promise<ChangeResult> {
    const actorUserId = resolveOwnerUserId(ctx);
    const result = await withModelSafeStoreErrors(() =>
      changeExplicitCaptureOutcome({ actorUserId, ...input }),
    );
    if (result && typeof result === "object" && "affectedScopes" in result) {
      const affectedScopes = result.affectedScopes;
      if (Array.isArray(affectedScopes)) {
        await requestBackgroundAffectedScopeReconciliation(affectedScopes);
      }
    }

    // The clarification branch writes nothing, so an unreadable question means the
    // correction did not happen and there is no question to ask either. That is a
    // real failure, and it is raised before anything can be reported as changed.
    const rawClarification = field(result, "clarification");
    if (rawClarification !== undefined) {
      const parsed = conversationalCaptureClarificationSchema.safeParse(rawClarification);
      if (!parsed.success) {
        throw new Error(
          "The correction was not applied and Tendnote could not say what it needs. Tell the " +
            "user it did not go through and ask them to restate the correction; do not retry " +
            "this call unchanged.",
        );
      }
      return { changed: false, clarification: parsed.data, target: input.target };
    }

    // Every applied correction carries a confirmation, so its absence means nothing
    // landed. A confirmation that is present but unreadable is the opposite case:
    // the write committed, and only its description is unusable.
    const rawConfirmation = field(result, "confirmation");
    if (rawConfirmation === undefined) {
      throw new Error(
        "The correction did not complete and nothing was changed. Tell the user plainly and " +
          "do not retry this call.",
      );
    }
    const parsed = conversationalCaptureConfirmationSchema.safeParse(rawConfirmation);
    return {
      changed: true,
      confirmation: parsed.success ? parsed.data : null,
      target: input.target,
    };
  },
  toModelOutput(output) {
    if (!output.changed) {
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
    if (!confirmation) {
      // The correction is committed; only the description of it is missing. Say the
      // true minimum rather than inventing a destination or re-running the write.
      return {
        type: "json" as const,
        value: {
          changed: true,
          target: output.target,
          guidance:
            "The correction was applied, but Tendnote returned no readable description of it. Confirm only that the capture was corrected — do not name a destination, do not repeat the saved text, and do not call this tool again.",
        },
      };
    }
    const outcome = confirmation.destination === "Grouped" ? undefined : confirmation;
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
