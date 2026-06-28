import { getSuggestedMemoryReview } from "@tendnote/db/queries/memories";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";

const inputSchema = z.object({
  memoryId: z.uuid().describe("The persisted suggested-memory id to load for review."),
});

/**
 * Thin wrapper over the shared review reader. Returns the authoritative persisted
 * record (memory + source context) so the assistant renders a fixed typed
 * `suggested_memory_review` component referencing real ids, never model output
 * (ADR 0027, ADR 0028).
 */
export default defineTool({
  description:
    "Load a persisted suggested memory for review by id. Suggested memories are TENTATIVE and not yet approved — present them for review, never state them as durable facts. Returns the memory, its source context, and a fixed typed component referencing persisted ids. Use approve_suggested_memory to save it or dismiss_suggested_memory to reject it.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const review = await getSuggestedMemoryReview({ ownerUserId, memoryId: input.memoryId });

    if (!review) {
      return { found: false as const };
    }

    return {
      found: true as const,
      component: review.component,
      // The person the suggestion belongs to, resolved so the assistant names
      // them instead of surfacing a raw id (ADR 0028); null only if the person
      // was removed out from under the suggestion.
      person: review.person
        ? { id: review.person.id, displayName: review.person.displayName }
        : null,
      memory: {
        id: review.memory.id,
        personId: review.memory.personId,
        content: review.memory.content,
        status: review.memory.status,
        sensitivity: review.memory.sensitivity,
        sourceRecordId: review.memory.sourceRecordId,
      },
      sourceRecord: review.sourceRecord
        ? { id: review.sourceRecord.id, content: review.sourceRecord.content }
        : null,
    };
  },
  // The suggestion is rendered as an interactive review card the user already sees.
  // Drop the suggestion/source text from the model's view (Eve `toModelOutput`) so it
  // can't reprint it; keep the ids so the user can ask you to approve or dismiss it.
  // The channel still gets the full output above for rendering. If you need the exact
  // wording later, re-load it by id rather than carrying it in your reply.
  toModelOutput(output) {
    if (!output.found || !output.memory) {
      return {
        type: "json" as const,
        value: {
          found: false,
          guidance: "That suggestion is no longer available to review. Tell the user.",
        },
      };
    }
    return {
      type: "json" as const,
      value: {
        found: true,
        memoryId: output.memory.id,
        personId: output.memory.personId,
        person: output.person?.displayName ?? null,
        sensitivity: output.memory.sensitivity,
        rendered:
          "The suggested memory is shown to the user in a review card with approve/dismiss controls.",
        guidance:
          "It's TENTATIVE and unapproved — never state it as fact. Don't reprint the suggestion text; it's in the card. Present it for review in a brief line; approve or dismiss only on the user's explicit say-so.",
      },
    };
  },
});
