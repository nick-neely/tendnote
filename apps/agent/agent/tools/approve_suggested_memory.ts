import { saveSuggestedMemory } from "@tendnote/db";
import { memoryReviewEditSchema } from "@tendnote/domain";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";

const inputSchema = z.object({
  memoryId: z.uuid().describe("The persisted suggested-memory id to approve."),
  edit: memoryReviewEditSchema
    .optional()
    .describe(
      "Optional corrections to apply before approving (e.g. fix wording or set a manual sensitivity). A provided sensitivity is a manual override.",
    ),
});

/**
 * Thin wrapper over the shared owner-scoped save: promotes a tentative suggested
 * memory to an approved, durable fact, applying any edit first (ADR 0002, ADR
 * 0056). Only act on explicit user approval — never approve on the user's behalf.
 */
export default defineTool({
  description:
    "Approve a suggested memory, promoting it to a durable confirmed fact. Only call this when the user has explicitly approved the suggestion. Optionally apply edits first. Returns the persisted memory id and new status for the review component.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const result = await saveSuggestedMemory({
      ownerUserId,
      memoryId: input.memoryId,
      edit: input.edit,
    });

    return {
      component: result.component,
      memory: {
        id: result.memory.id,
        personId: result.memory.personId,
        content: result.memory.content,
        status: result.memory.status,
        sensitivity: result.memory.sensitivity,
        sourceRecordId: result.memory.sourceRecordId,
        approvedAt: result.memory.approvedAt?.toISOString() ?? null,
      },
    };
  },
});
