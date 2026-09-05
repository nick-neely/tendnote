import { archiveSelfContextFact } from "@tendnote/db/queries/context-facts";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireOwnerApproval } from "../lib/approval";
import { describeRegisteredSubject } from "../lib/approval/subject-registry";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { toSelfContextFactToolView } from "../lib/self-context-fact-view";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  contextFactId: z
    .uuid()
    .describe(
      "The exact active Self Context fact id, copied from a `list_self_context` or `get_self_context_fact` result in this conversation. Never guess one.",
    ),
  expectedUpdatedAt: z.iso
    .datetime()
    .optional()
    .describe(
      "The `updatedAt` this same fact carried in the `list_self_context` or `get_self_context_fact` result you read it from in THIS conversation - copy it verbatim, never compose a timestamp. It makes the archive fail loudly if the user changed the fact elsewhere since you read it. Omit it only when you genuinely have no such result (an id carried over from an earlier session); read the fact first instead.",
    ),
});

export default defineTool({
  approval: requireOwnerApproval({
    describe: describeRegisteredSubject(),
    reversiblePrivateWrite: true,
  }),
  description:
    "Archive one active Self Context fact only on the user's explicit current-turn request. Use the exact id from a prior tool result, never guess or sweep, and pass expectedUpdatedAt when available. Archive is recoverable; permanent deletion remains an Account action, not an Eve action.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const outcome = await withModelSafeStoreErrors(() =>
      archiveSelfContextFact(
        {
          callerUserId: ownerUserId,
          contextFactId: input.contextFactId,
          expectedUpdatedAt: input.expectedUpdatedAt
            ? new Date(input.expectedUpdatedAt)
            : undefined,
        },
        async () => ownerUserId,
      ),
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
