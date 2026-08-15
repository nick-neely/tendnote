import { getSuggestedFollowupReview } from "@tendnote/db/queries/followups";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { withModelSafeStoreErrors } from "../lib/store-errors";

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

    const review = await withModelSafeStoreErrors(() =>
      getSuggestedFollowupReview({
        actorUserId: ownerUserId,
        followupId: input.followupId,
      }),
    );

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
  // The suggestion renders as a review card the user already sees. Drop the reason and
  // due date from the model's view (Eve `toModelOutput`) so it can't reprint them;
  // keep the id + person so the user can ask you to accept or dismiss it.
  toModelOutput(output) {
    if (!output.found || !output.followup) {
      return {
        type: "json" as const,
        value: {
          found: false,
          guidance: "That suggested follow-up is gone or already resolved. Tell the user.",
        },
      };
    }
    return {
      type: "json" as const,
      value: {
        found: true,
        followupId: output.followup.id,
        personId: output.followup.personId,
        person: output.person?.displayName ?? null,
        status: output.followup.status,
        rendered:
          "The suggested follow-up is shown to the user in a review card they can accept, edit, or dismiss.",
        guidance:
          "TENTATIVE, not an active reminder. Don't reprint the reason or due date — the card shows them. Present it for review briefly; accept only on the user's explicit say-so.",
      },
    };
  },
});
