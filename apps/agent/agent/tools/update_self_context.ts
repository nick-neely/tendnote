import { updateSelfContextFact } from "@tendnote/db/queries/context-facts";
import { selfContextFactCategorySchema } from "@tendnote/domain/context-facts";
import { sensitivitySchema } from "@tendnote/domain/privacy";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { toSelfContextFactToolView } from "../lib/self-context-fact-view";

const inputSchema = z.object({
  contextFactId: z
    .uuid()
    .describe("The exact active Self Context fact id returned by a prior tool call."),
  category: selfContextFactCategorySchema,
  content: z.string().trim().min(1).max(500).describe("The user's explicit corrected wording."),
  sensitivity: sensitivitySchema,
  expectedUpdatedAt: z.iso
    .datetime()
    .optional()
    .describe(
      "The last updatedAt returned by a prior tool call when protecting against stale intent.",
    ),
});

export default defineTool({
  description:
    "Correct one active Self Context fact only when the user explicitly asks to change it. Use the exact id from a prior Self Context result, preserve the user's wording, and pass expectedUpdatedAt when available so stale intent cannot overwrite a newer correction. This replaces the current statement rather than creating a parallel fact; a conflict is returned for focused clarification.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const outcome = await updateSelfContextFact(
      {
        callerUserId: ownerUserId,
        contextFactId: input.contextFactId,
        category: input.category,
        content: input.content,
        sensitivity: input.sensitivity,
        expectedUpdatedAt: input.expectedUpdatedAt ? new Date(input.expectedUpdatedAt) : undefined,
      },
      async () => ownerUserId,
    );
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);

    return {
      decision: outcome.decision,
      fact: toSelfContextFactToolView(outcome.result),
      guidance:
        "The corrected active statement is authoritative for future turns; do not show its raw id.",
    };
  },
});
