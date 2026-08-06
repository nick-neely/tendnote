import { archiveSelfContextFact } from "@tendnote/db/queries/context-facts";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { toSelfContextFactToolView } from "../lib/self-context-fact-view";

const inputSchema = z.object({
  contextFactId: z
    .uuid()
    .describe("The exact active Self Context fact id returned by a prior tool call."),
  expectedUpdatedAt: z.iso
    .datetime()
    .optional()
    .describe(
      "The last updatedAt returned by a prior tool call when protecting against stale intent.",
    ),
});

export default defineTool({
  description:
    "Archive one active Self Context fact only on the user's explicit current-turn request. Use the exact id from a prior tool result, never guess or sweep, and pass expectedUpdatedAt when available. Archive is recoverable; permanent deletion remains an Account action, not an Eve action.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const outcome = await archiveSelfContextFact(
      {
        callerUserId: ownerUserId,
        contextFactId: input.contextFactId,
        expectedUpdatedAt: input.expectedUpdatedAt ? new Date(input.expectedUpdatedAt) : undefined,
      },
      async () => ownerUserId,
    );
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);

    return {
      decision: outcome.decision,
      fact: toSelfContextFactToolView(outcome.result),
      guidance:
        "The fact is archived and no longer enters automatic orientation; do not show its raw id.",
    };
  },
});
