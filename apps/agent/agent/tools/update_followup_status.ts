import {
  archiveFollowup,
  completeFollowup,
  dismissFollowup,
  reopenFollowup,
  snoozeFollowup,
} from "@tendnote/db/queries/followups";
import type { Followup } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";

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

/** Dispatches one validated transition to its shared lifecycle function. */
function applyTransition(input: UpdateFollowupInput, ownerUserId: string): Promise<Followup> {
  const { followupId } = input;

  switch (input.status) {
    case "complete":
      return completeFollowup({ actorUserId: ownerUserId, followupId });
    case "dismiss":
      return dismissFollowup({ actorUserId: ownerUserId, followupId });
    case "reopen":
      return reopenFollowup({ actorUserId: ownerUserId, followupId });
    case "archive":
      return archiveFollowup({ actorUserId: ownerUserId, followupId });
    case "snooze": {
      if (!input.dueAt) {
        throw new Error("Snoozing a follow-up needs a new due date.");
      }

      // Parsed here; the shared layer rejects anything that isn't a concrete date.
      return snoozeFollowup({ actorUserId: ownerUserId, followupId, dueAt: new Date(input.dueAt) });
    }
  }
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
    const followup = await applyTransition(input, ownerUserId);

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
