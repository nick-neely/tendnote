import { restoreSelfContextFact } from "@tendnote/db/queries/context-facts";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { toSelfContextFactToolView } from "../lib/self-context-fact-view";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  contextFactId: z
    .uuid()
    .describe("The exact archived Self Context fact id returned by a prior tool call."),
  expectedArchivedAt: z.iso
    .datetime()
    .optional()
    .describe("The archivedAt returned by the archive result for an authoritative Undo."),
});

/**
 * What the shared restore actually decided, in the two shapes it can return.
 *
 * The tool used to answer with one sentence — "the restored fact is eligible for
 * future orientation" — on both branches. But the store's `existing` branch does not
 * restore anything: it finds an equivalent *active* fact, leaves the archived one
 * archived, and hands back the other record. Reported as a restore, that is a false
 * success about the user's own facts, and the returned id belongs to a fact the user
 * never named.
 */
const RESTORE_GUIDANCE = {
  restored: "The fact is active again and eligible for future orientation; do not show its raw id.",
  existing:
    "Nothing was restored: an equivalent fact is already active, so the archived one was left " +
    "archived. The returned fact is that existing active one, not the archived fact the user " +
    "named. Say the fact is already there rather than confirming a restore, and do not retry.",
} as const;

export default defineTool({
  description:
    "Restore one archived Self Context fact only on an explicit user request or authoritative Undo. Use the exact id and, when available, expectedArchivedAt from the archive result so stale intent cannot restore over a later change. The shared product layer rejects duplicates or conflicts instead of creating contradictory active facts. It reports whether the archived fact was actually restored or an equivalent fact was already active — never claim a restore the result does not report.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const outcome = await withModelSafeStoreErrors(() =>
      restoreSelfContextFact(
        {
          callerUserId: ownerUserId,
          contextFactId: input.contextFactId,
          expectedArchivedAt: input.expectedArchivedAt
            ? new Date(input.expectedArchivedAt)
            : undefined,
        },
        async () => ownerUserId,
      ),
    );
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);

    // Every other decision the shared mutation can carry ("created", "updated",
    // "archived", "accepted") is unreachable from restore; treating anything that is
    // not the duplicate branch as a restore keeps the report closed over the two
    // outcomes this path can actually produce.
    const restored = outcome.decision !== "existing";

    return {
      restored,
      decision: outcome.decision,
      fact: toSelfContextFactToolView(outcome.result),
      guidance: restored ? RESTORE_GUIDANCE.restored : RESTORE_GUIDANCE.existing,
    };
  },
});
