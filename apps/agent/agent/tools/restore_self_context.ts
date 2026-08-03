import { restoreSelfContextFact } from "@tendnote/db/queries/context-facts";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { toSelfContextFactToolView } from "../lib/self-context-fact-view";

const inputSchema = z.object({
  contextFactId: z
    .uuid()
    .describe("The exact archived Self Context fact id returned by a prior tool call."),
  expectedArchivedAt: z.iso
    .datetime()
    .optional()
    .describe("The archivedAt returned by the archive result for an authoritative Undo."),
});

export default defineTool({
  description:
    "Restore one archived Self Context fact only on an explicit user request or authoritative Undo. Use the exact id and, when available, expectedArchivedAt from the archive result so stale intent cannot restore over a later change. The shared product layer rejects duplicates or conflicts instead of creating contradictory active facts.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const outcome = await restoreSelfContextFact(
      {
        callerUserId: ownerUserId,
        contextFactId: input.contextFactId,
        expectedArchivedAt: input.expectedArchivedAt
          ? new Date(input.expectedArchivedAt)
          : undefined,
      },
      async () => ownerUserId,
    );
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);

    return {
      decision: outcome.decision,
      fact: toSelfContextFactToolView(outcome.result),
      guidance: "The restored fact is eligible for future orientation; do not show its raw id.",
    };
  },
});
