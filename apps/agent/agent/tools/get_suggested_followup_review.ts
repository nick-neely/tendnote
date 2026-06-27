import { getSuggestedFollowupReview } from "@tendnote/db/queries/followups";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";

const inputSchema = z.object({
  followupId: z.uuid().describe("The persisted suggested follow-up id to pull up."),
});

/**
 * Thin wrapper to load one suggested follow-up by id as a fixed typed review
 * component (ADR-0028). Returns `found: false` when it is missing or no longer
 * suggested, so the chat never renders a stale card.
 */
export default defineTool({
  description:
    "Pull up one suggested follow-up by id for review. Returns the suggestion, its person, grounding source record, and a fixed typed component, or found: false if it is gone or already resolved. The suggestion is tentative until the user accepts it; never present it as an active reminder.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const review = await getSuggestedFollowupReview({ ownerUserId, followupId: input.followupId });

    if (!review) {
      return { found: false as const };
    }

    return {
      found: true as const,
      component: review.component,
      person: review.person
        ? { id: review.person.id, displayName: review.person.displayName }
        : null,
      followup: {
        id: review.followup.id,
        personId: review.followup.personId,
        reason: review.followup.reason,
        dueAt: review.followup.dueAt.toISOString(),
        status: review.followup.status,
      },
      sourceRecord: review.sourceRecord ? { id: review.sourceRecord.id } : null,
    };
  },
});
