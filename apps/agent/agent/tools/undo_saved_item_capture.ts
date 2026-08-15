import { undoExplicitCaptureOutcome } from "@tendnote/db/queries/conversational-capture";
import {
  ConversationalCaptureUndoError,
  conversationalCaptureUndoTargetSchema,
} from "@tendnote/domain/conversational-capture";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

/**
 * What actually happened, in the four shapes the shared Undo can produce.
 *
 * The tool used to answer `undone: true` unconditionally, so "that was already
 * undone", "that record is gone", and "Tendnote will not invert this" all reached
 * the model as a fresh success — and the model then told the user it had just
 * undone something it had not touched. Each branch now carries its own guidance,
 * because the right next sentence differs: confirm, say it was already undone,
 * or say plainly that it did not happen and stop.
 */
const UNDO_GUIDANCE = {
  undone: "Confirm briefly that the captured destination record was authoritatively undone.",
  already_undone:
    "Nothing changed on this call: that capture was already undone. Say it is already undone " +
    "rather than confirming a fresh change, and do not call Undo again for this target.",
  not_found:
    "Nothing was undone: the record this target names is no longer there. Tell the user " +
    "plainly, and do not retry with a different id or a guessed target.",
  refused:
    "Nothing was undone: Tendnote will not invert this capture. Relay the returned reason as " +
    "the explanation, offer the Change tool or a Tendnote surface instead, and do not retry.",
} as const;

export default defineTool({
  description:
    "Safely Undo a just-completed capture_saved_item operation when the user explicitly asks. Applies the returned authoritative inverse (archiving a new record or restoring the prior Context Fact value) while preserving source evidence. Use the exact undoTarget returned by Capture. It reports whether the inverse ran now, was already undone, or did not happen at all — never claim an Undo the result does not report.",
  inputSchema: z.object({
    target: conversationalCaptureUndoTargetSchema.describe(
      "The exact undoTarget returned by capture_saved_item.",
    ),
  }),
  async execute(input, ctx) {
    const actorUserId = resolveOwnerUserId(ctx);
    try {
      const result = await withModelSafeStoreErrors(() =>
        undoExplicitCaptureOutcome({ actorUserId, ...input }),
      );
      await requestBackgroundAffectedScopeReconciliation(result.affectedScopes);
      return { target: input.target, outcome: result.outcome, reason: null };
    } catch (error) {
      // A refusal is a real answer about the user's own record, not a fault, so it is
      // reported with guidance rather than thrown as a tool error the model has to
      // guess its way around. Infrastructure failures still escape (already made
      // model-safe above), because "it did not work" is all anyone should be told.
      if (error instanceof ConversationalCaptureUndoError) {
        return { target: input.target, outcome: error.reason, reason: error.message };
      }
      throw error;
    }
  },
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        target: output.target,
        // One enum rather than a boolean: "already undone" is neither a fresh
        // success nor a failure, and a `undone: false` beside it would read as one.
        outcome: output.outcome,
        ...(output.reason ? { reason: output.reason } : {}),
        guidance: UNDO_GUIDANCE[output.outcome],
      },
    };
  },
});
