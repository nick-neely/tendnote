import { dismissDraft } from "@tendnote/db/queries/drafts";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  draftId: z
    .uuid()
    .describe(
      "The draft to throw away, copied exactly from `list_message_drafts` or the `create_message_draft` result. Never guess one; ask which message they mean if more than one could match.",
    ),
});

/**
 * Clearing a draft the user does not want, on their say-so.
 *
 * The narrow one of the two draft tools, and narrow for the same reason `edit_draft_body`
 * is careful: a draft is text the user may have read and be about to use, and Eve's own
 * opinion of its quality is not a reason to remove it. Dismissal is a lifecycle
 * transition through the shared seam, so it is audited and reversible only where the
 * domain says it is - and it changes nothing about the memories, notes, or follow-ups
 * the draft was grounded in.
 *
 * It is deliberately not the other transitions. Approving is the user's mark of
 * readiness (ADR 0088), marking sent-manually is a claim about something that happened
 * outside Tendnote, and neither is an inference Eve is entitled to make.
 */
export default defineTool({
  description:
    "Throw away one of the user's Tendnote message drafts, when they explicitly say so in the current turn ('scrap that one', 'delete the draft to Sam'). Requires a draftId from `list_message_drafts` or from creating it. This is a Tendnote-only lifecycle change: nothing is sent, nothing external is touched, and the notes and memories the draft was built from are untouched. Do NOT dismiss a draft because you think it is weak, stale, duplicated, or superseded by one you just wrote - that is the user's call, not yours - and do NOT dismiss several at once. Never use this to approve a draft or to mark one as sent; those are the user's own actions in the app. Confirm plainly afterwards and offer to write another only if they ask.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const outcome = await withModelSafeStoreErrors(() =>
      dismissDraft({ ownerUserId, draftId: input.draftId }),
    );
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);

    return {
      draftId: outcome.result.id,
      // The persisted status, not a claim about what this call did.
      status: outcome.result.status,
    };
  },
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        status: output.status,
        guidance:
          "The draft is dismissed and out of the user's drafts. Confirm in one short line " +
          "without reprinting what it said. Nothing was sent and nothing else changed; do " +
          "not immediately write a replacement unless they ask for one.",
      },
    };
  },
});
