import { dismissSuggestedFollowup } from "@tendnote/db/queries/followups";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";

const inputSchema = z.object({
  followupId: z.uuid().describe("The persisted suggested follow-up id to dismiss."),
});

/**
 * Thin wrapper over the shared dismiss: removes a suggested follow-up from review
 * and reminder feeds without creating a reminder, preserving history so the same
 * suggestion is not reintroduced (PRD #42, ADR-0006). Only call on the user's
 * explicit rejection.
 */
export default defineTool({
  description:
    "Dismiss a suggested follow-up the user does not want. Only call this when the user has explicitly rejected it. It leaves review without creating any reminder. Returns the persisted id and new status; name the person, never the raw id.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const followup = await dismissSuggestedFollowup({ ownerUserId, followupId: input.followupId });

    return {
      followup: {
        id: followup.id,
        personId: followup.personId,
        status: followup.status,
      },
    };
  },
});
