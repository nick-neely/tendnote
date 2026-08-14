import { dismissSuggestedMemory } from "@tendnote/db/queries/memories";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  memoryId: z.uuid().describe("The persisted suggested-memory id to dismiss."),
});

/**
 * Thin wrapper over the shared owner-scoped dismiss: rejects a suggested memory
 * so it leaves review and is excluded from retrieval (ADR 0002). Dismissed
 * suggestions are not reintroduced. Only dismiss on explicit user instruction.
 */
export default defineTool({
  description:
    "Dismiss a suggested memory the user does not want kept. It leaves review and is excluded from future context. Only call this when the user has explicitly rejected the suggestion. Returns the persisted memory id and new status.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const outcome = await withModelSafeStoreErrors(() =>
      dismissSuggestedMemory({ ownerUserId, memoryId: input.memoryId }),
    );
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);
    const memory = outcome.result;

    return {
      memory: {
        id: memory.id,
        personId: memory.personId,
        status: memory.status,
        sourceRecordId: memory.sourceRecordId,
      },
    };
  },
});
