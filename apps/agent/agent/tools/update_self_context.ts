import { updateSelfContextFact } from "@tendnote/db/queries/context-facts";
import { selfContextFactCategorySchema } from "@tendnote/domain/context-facts";
import { sensitivitySchema } from "@tendnote/domain/privacy";
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
  category: selfContextFactCategorySchema.describe(
    "Which kind of orienting fact this is. Keep the category the fact already has unless the user's correction changes what the fact is about.",
  ),
  content: z.string().trim().min(1).max(500).describe("The user's explicit corrected wording."),
  sensitivity: sensitivitySchema.describe(
    "How delicate the corrected statement is. Keep the fact's existing level unless the user's own correction makes it more delicate; never lower it on your own judgement.",
  ),
  expectedUpdatedAt: z.iso
    .datetime()
    .optional()
    .describe(
      "The `updatedAt` this same fact carried in the `list_self_context` or `get_self_context_fact` result you read it from in THIS conversation - copy it verbatim, never compose a timestamp. It makes the correction fail loudly if the user changed the fact elsewhere since you read it, instead of silently overwriting them. Omit it only when you genuinely have no such result (an id carried over from an earlier session); read the fact first instead.",
    ),
});

export default defineTool({
  approval: requireOwnerApproval({ describe: describeRegisteredSubject() }),
  description:
    "Correct one active Self Context fact only when the user explicitly asks to change it. Use the exact id from a prior Self Context result, preserve the user's wording, and pass expectedUpdatedAt when available so stale intent cannot overwrite a newer correction. This replaces the current statement rather than creating a parallel fact; a conflict is returned for focused clarification. This call pauses for the user's approval; if they cancel, say it did not happen and do not retry it or route around it.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);
    const outcome = await withModelSafeStoreErrors(() =>
      updateSelfContextFact(
        {
          callerUserId: ownerUserId,
          contextFactId: input.contextFactId,
          category: input.category,
          content: input.content,
          sensitivity: input.sensitivity,
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
        "The corrected active statement is authoritative for future turns; do not show its raw id.",
    };
  },
});
