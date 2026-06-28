import { acceptSuggestedFollowup } from "@tendnote/db/queries/followups";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";

const inputSchema = z.object({
  followupId: z.uuid().describe("The persisted suggested follow-up id to accept."),
  edit: z
    .object({
      reason: z.string().min(1).optional(),
      dueAt: z.string().optional().describe("New proposed due date as an ISO 8601 string."),
    })
    .optional()
    .describe(
      "Optional corrections to apply before accepting (fix the wording or the proposed due date).",
    ),
});

/**
 * Thin wrapper over the shared accept: promotes a tentative suggested follow-up to
 * an active `open` reminder through the same transition matrix the active lifecycle
 * uses, applying any edit first (PRD #42, ADR-0006). Only call on the user's
 * explicit approval — never accept on the user's behalf.
 */
export default defineTool({
  description:
    "Accept a suggested follow-up, turning it into an active reminder. Only call this when the user has explicitly approved it. Optionally apply edits (reason or due date) first. Returns the now-active follow-up reference; name the person, never the raw id.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const result = await acceptSuggestedFollowup({
      ownerUserId,
      followupId: input.followupId,
      // Parse the proposed date here; the shared layer validates it is concrete.
      edit: input.edit
        ? {
            ...(input.edit.reason !== undefined ? { reason: input.edit.reason } : {}),
            ...(input.edit.dueAt !== undefined ? { dueAt: new Date(input.edit.dueAt) } : {}),
          }
        : undefined,
    });

    return {
      component: result.component,
      person: result.person
        ? { id: result.person.id, displayName: result.person.displayName }
        : null,
      followup: {
        id: result.followup.id,
        personId: result.followup.personId,
        reason: result.followup.reason,
        dueAt: result.followup.dueAt.toISOString(),
        status: result.followup.status,
      },
    };
  },
  // The now-active reminder renders as a card the user already sees. Keep the id,
  // person, status, and due date so the model can confirm naturally ("set for the
  // 5th"), but drop the full reason and remind it to keep the confirmation brief.
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        accepted: true,
        followupId: output.followup.id,
        personId: output.followup.personId,
        person: output.person?.displayName ?? null,
        status: output.followup.status,
        dueAt: output.followup.dueAt,
        rendered: "The now-active reminder is shown to the user in a card.",
        guidance:
          "Confirm briefly that the reminder is set (you can mention who and when) — don't restate the full reason; the card shows it.",
      },
    };
  },
});
