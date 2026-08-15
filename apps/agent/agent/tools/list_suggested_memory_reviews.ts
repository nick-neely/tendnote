import { listSuggestedMemoryReviews } from "@tendnote/db/queries/memories";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  personId: z
    .uuid()
    .optional()
    .describe(
      "Limit to one already-resolved person's open suggestions. Omit to list everything the user has waiting for review across all people.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Max suggestions to load (most important first). Defaults to a small set."),
});

/**
 * Thin wrapper over the shared review reader for the "what do I have to review?"
 * question. Returns every open suggested memory (optionally scoped to one person)
 * as fixed typed `suggested_memory_review` components referencing persisted ids
 * (ADR 0027, ADR 0028), so the chat renders an interactive review card per item
 * the user can approve or dismiss inline — in one tool call, rather than loading
 * each suggestion separately. Each item carries the person's resolved name so the
 * assistant never has to surface a raw id (ADR 0028).
 */
export default defineTool({
  description:
    "List the user's open suggested memories awaiting review, newest/most-important first. Use this for 'what do I have to review?', 'anything to review for <person>?', or 'review <person>'s suggestions' — it renders an interactive review card per suggestion that the user can approve or dismiss inline. Pass personId (resolve identity first) to scope to one person, or omit it for everything across all people. Suggested memories are TENTATIVE — present them for review, never as durable facts. Returns each memory, its person, and a fixed typed component referencing persisted ids; approve with approve_suggested_memory or reject with dismiss_suggested_memory.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const reviews = await withModelSafeStoreErrors(() =>
      listSuggestedMemoryReviews({
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
        // Resolved so the assistant names the person instead of a raw id (ADR 0028).
        person: review.person
          ? { id: review.person.id, displayName: review.person.displayName }
          : null,
        memory: {
          id: review.memory.id,
          content: review.memory.content,
          sensitivity: review.memory.sensitivity,
          sourceRecordId: review.memory.sourceRecordId,
        },
      })),
    };
  },
  // Each suggestion renders as its own interactive review card the user already sees.
  // Drop the suggestion text from the model's view (Eve `toModelOutput`) so it
  // summarizes instead of reprinting every one; keep each memoryId + person so the
  // user can ask you to approve or dismiss a specific one. Channel gets full output.
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        count: output.count,
        reviews: output.reviews.map((review) => ({
          memoryId: review.memory.id,
          person: review.person?.displayName ?? null,
          sensitivity: review.memory.sensitivity,
        })),
        rendered:
          "Each suggestion is shown to the user as its own review card with approve/dismiss controls.",
        guidance:
          "These are TENTATIVE and unapproved — never state them as fact. Don't reprint the suggestion text; the cards show it. Summarize in a brief line (how many and for whom); act only on the user's explicit approval.",
      },
    };
  },
});
