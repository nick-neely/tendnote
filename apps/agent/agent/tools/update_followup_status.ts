import {
  archiveFollowup,
  completeFollowup,
  dismissFollowup,
  reopenFollowup,
  snoozeFollowup,
} from "@tendnote/db/queries/followups";
import type { MutationOutcome } from "@tendnote/db/queries/general-actions";
import type { Followup } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  followupId: z.uuid().describe("The persisted follow-up id to update."),
  status: z
    .enum(["complete", "dismiss", "snooze", "reopen", "archive"])
    .describe("The lifecycle transition to apply. 'snooze' also requires a new dueAt."),
  dueAt: z
    .string()
    .optional()
    .describe(
      "New concrete due date as an ISO 8601 string, required when status is 'snooze'. Resolve relative phrases to a concrete date; ask the user if the new timing is ambiguous.",
    ),
});

type UpdateFollowupInput = z.infer<typeof inputSchema>;

/**
 * The shared lifecycle function each validated transition maps to, keyed by status so
 * dispatch is a flat table lookup rather than a switch. `snooze` also parses its new
 * due date here; the shared layer rejects anything that isn't a concrete date.
 */
const followupTransitions: Record<
  UpdateFollowupInput["status"],
  (input: UpdateFollowupInput, ownerUserId: string) => Promise<MutationOutcome<Followup>>
> = {
  complete: ({ followupId }, ownerUserId) =>
    completeFollowup({ actorUserId: ownerUserId, followupId }),
  dismiss: ({ followupId }, ownerUserId) =>
    dismissFollowup({ actorUserId: ownerUserId, followupId }),
  reopen: ({ followupId }, ownerUserId) => reopenFollowup({ actorUserId: ownerUserId, followupId }),
  archive: ({ followupId }, ownerUserId) =>
    archiveFollowup({ actorUserId: ownerUserId, followupId }),
  snooze: ({ followupId, dueAt }, ownerUserId) => {
    if (!dueAt) {
      throw new Error("Snoozing a follow-up needs a new due date.");
    }
    return snoozeFollowup({ actorUserId: ownerUserId, followupId, dueAt: new Date(dueAt) });
  },
};

/** Dispatches one validated transition to its shared lifecycle function. */
function applyTransition(
  input: UpdateFollowupInput,
  ownerUserId: string,
): Promise<MutationOutcome<Followup>> {
  return followupTransitions[input.status](input, ownerUserId);
}

/**
 * Thin wrapper over the shared follow-up lifecycle transitions (PRD #42). Eve only
 * acts on the user's explicit instruction; the shared layer validates the
 * transition, owner-scopes it, and writes the audit entry, so chat behavior cannot
 * fork from web behavior. Returns a compact persisted reference, never a raw id in
 * prose.
 */
export default defineTool({
  description:
    "Update an active follow-up's status through the shared lifecycle: complete, dismiss, snooze (to a new dueAt), reopen, or archive. Only act on the user's explicit instruction. For snooze, pass a concrete dueAt — ask the user if the new timing is ambiguous. Invalid transitions are rejected. Returns the updated follow-up reference (id, reason, due date, status, plus the person id for your tool calls); refer to the person by name from context and never show the raw id.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const outcome = await withModelSafeStoreErrors(() => applyTransition(input, ownerUserId));
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);
    const followup = outcome.result;

    return {
      followup: {
        id: followup.id,
        personId: followup.personId,
        reason: followup.reason,
        dueAt: followup.dueAt.toISOString(),
        status: followup.status,
      },
    };
  },
});
