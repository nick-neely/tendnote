import { listSuggestedFollowupReviews } from "@tendnote/db/queries/followups";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { withModelSafeStoreErrors } from "../lib/store-errors";

/**
 * How many suggestions one unbounded ask returns. The shared store applies no
 * limit when the caller omits one, so "any follow-ups to review?" used to render
 * a review card for every open suggestion the owner has while the description
 * promised "a small set". Ten matches what a review pass can actually get through
 * in a turn; an explicit `limit` up to the schema maximum still works.
 */
const DEFAULT_SUGGESTED_FOLLOWUP_REVIEW_LIMIT = 10;

const inputSchema = z.object({
  personId: z
    .uuid()
    .optional()
    .describe(
      "Limit to one resolved person's suggested follow-ups. Omit for everything across all people.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(DEFAULT_SUGGESTED_FOLLOWUP_REVIEW_LIMIT)
    .describe(`Max suggestions to load. Defaults to ${DEFAULT_SUGGESTED_FOLLOWUP_REVIEW_LIMIT}.`),
});

/**
 * Thin wrapper over the shared suggested-follow-up review reader for "what
 * follow-ups should I review?". Returns each open suggested follow-up as a fixed
 * typed `suggested_followup_review` component referencing persisted ids
 * (ADR-0027/0028), so the chat renders an interactive review card per suggestion
 * the user can accept or dismiss inline. Suggestions are TENTATIVE — present them
 * for review, never as active reminders.
 */
export default defineTool({
  description:
    "List the user's suggested follow-ups awaiting review. Use for 'any follow-ups to review?' or 'review follow-ups for <person>?' — it renders an interactive card per suggestion the user can accept or dismiss inline. Pass personId (resolve identity first) to scope to one person, or omit for everything. Suggested follow-ups are TENTATIVE proposals, not active reminders; never present them as committed. Returns each suggestion, its person, grounding source record, and a fixed typed component referencing persisted ids.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const reviews = await withModelSafeStoreErrors(() =>
      listSuggestedFollowupReviews({
        ownerUserId,
        personId: input.personId,
        limit: input.limit,
      }),
    );

    return {
      found: true as const,
      personId: input.personId ?? null,
      count: reviews.length,
      reviews: reviews.map((review) => ({
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
      })),
    };
  },
  // Each suggestion renders as its own review card the user already sees. Drop the
  // reasons and due dates from the model's view (Eve `toModelOutput`) so it summarizes
  // instead of reprinting every one; keep each followupId + person so the user can ask
  // you to accept or dismiss a specific one. Channel gets the full output for rendering.
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        count: output.count,
        reviews: output.reviews.map((review) => ({
          followupId: review.followup.id,
          person: review.person?.displayName ?? null,
          status: review.followup.status,
        })),
        rendered:
          "Each suggested follow-up is shown to the user as its own review card they can accept or dismiss.",
        guidance:
          "These are TENTATIVE suggestions, not active reminders. Don't reprint the reasons or due dates — the cards show them. Summarize briefly (how many, for whom); act only on explicit approval.",
      },
    };
  },
});
