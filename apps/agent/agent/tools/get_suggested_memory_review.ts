import { getSuggestedMemoryReview } from "@tendnote/db";
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
});
