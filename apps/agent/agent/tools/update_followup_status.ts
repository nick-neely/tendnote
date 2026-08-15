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

/**
 * `dueAt` belongs to exactly one transition, enforced at parse time.
 *
 * Both halves matter. Without a date, `snooze` used to reach the executor and
 * throw a bare `Error` the model met as the opaque store sentence. With a date on
 * some *other* status, the call parsed, ignored the date, and applied that other
 * status - so "push Alex's reminder to next week" sent as `{complete, dueAt}`
 * completed the reminder instead. Both are refused here, where the message can
 * name the field to fix.
 *
 * A refinement over a flat object rather than a discriminated union: eve hands
 * this schema to the provider as JSON Schema, and zod renders a top-level union
 * as a root `oneOf` with no `"type": "object"`.
 */
const inputSchema = z
  .object({
    followupId: z.uuid().describe("The persisted follow-up id to update."),
    status: z
      .enum(["complete", "dismiss", "snooze", "reopen", "archive"])
      .describe(
        "The lifecycle transition to apply. 'snooze' requires a new dueAt and every other transition forbids one.",
      ),
    dueAt: z
      .string()
      .optional()
      .describe(
        "New concrete due date as an ISO 8601 string. Required when status is 'snooze', and not accepted with any other status. Resolve relative phrases to a concrete date; ask the user if the new timing is ambiguous.",
      ),
  })
  .superRefine((input, ctx) => {
    if (input.status === "snooze" && input.dueAt === undefined) {
      ctx.addIssue({
        code: "custom",
        message:
          "Snoozing a follow-up needs a new due date: pass dueAt as an ISO 8601 date. Ask the " +
          "user when it should come back if the new timing is ambiguous.",
        path: ["dueAt"],
      });
      return;
    }
    if (input.status !== "snooze" && input.dueAt !== undefined) {
      ctx.addIssue({
        code: "custom",
        message:
          `dueAt applies only to status "snooze", not "${input.status}" - this call would have ` +
          `applied "${input.status}" to the follow-up and silently dropped the date. Use status ` +
          '"snooze" to move it out.',
        path: ["dueAt"],
      });
    }
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
    // Unreachable through the tool: the schema refuses `snooze` without a date before
    // `execute` runs. Kept because this is also the type narrowing, and a silent
    // `new Date(undefined)` here would snooze the follow-up to Invalid Date.
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
