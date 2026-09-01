import { editDraftBody } from "@tendnote/db/queries/drafts";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
import { DRAFT_REVISION_REPLY_CANONICAL } from "../lib/response-contracts";
import { withModelSafeStoreErrors } from "../lib/store-errors";

const inputSchema = z.object({
  draftId: z
    .uuid()
    .describe(
      "The draft to change, copied exactly from `list_message_drafts` or the `create_message_draft` result. Never guess one; ask which message they mean if more than one could match.",
    ),
  body: z
    .string()
    .trim()
    .min(1)
    .max(10000)
    .describe(
      "The complete new text of the message. Take what is there now and apply only the change the user asked for in this turn - keep every other sentence as it stands. Never send back a fresh draft you wrote from scratch.",
    ),
});

/**
 * A revision the user asked for, not a rewrite Eve preferred.
 *
 * ADR 0088's rule is that an update needs *current* intent, and a whole-body write is
 * the shape most likely to break it: the seam takes the full text, so a model that
 * regenerates instead of editing replaces work the user has already read and approved
 * of, and the diff never appears anywhere they would notice. The schema cannot prevent
 * that, so the description and the guidance both say the same thing in the two places
 * the model reads - change what was asked for, keep the rest.
 *
 * An *active* draft is editable whichever side of approval it sits on - the same rule
 * the person page applies (`apps/web/src/components/person-drafts.tsx`, `isActive`) -
 * and the seam refuses only a draft that is finished with: dismissed, or already sent
 * by the user themselves. Editing an *approved* draft is the user's own correction to
 * make, but the shared lifecycle revokes the approval atomically in the same write:
 * the body changes and the status returns to `draft`. Approval is readiness for the
 * exact text the user read, and the Gmail export gate trusts `status === "approved"`
 * against the current body - so leaving the approval in place would let a revised,
 * unread body be exported on the old approval. That is why an edited draft comes back
 * as `draft` and the result reports the status, and why the new wording must be
 * re-approved before it can be saved to Gmail.
 *
 * Nothing here sends. `save_draft_to_gmail` remains the only path out of Tendnote and
 * still runs the same explicit approval gate the web surface does (ADR 0092). The
 * model-facing confirmation repeats the internal/unapproved boundary because a
 * natural-language "done" after this call must never turn into readiness, an external
 * draft, or a send claim.
 */
export default defineTool({
  description:
    "Rewrite the body of one of the user's existing Tendnote message drafts, when they ask for a change in the current turn ('make it shorter', 'take out the bit about the move', 'warmer opening'). Requires a draftId from `list_message_drafts` or from creating it. Send the COMPLETE new text: start from what the draft says now and apply only what they asked for this turn - never regenerate the message from scratch, never quietly improve wording they did not mention, and never fold in facts they did not ask you to add. Do NOT use this to write a new draft (`create_message_draft`) or to act on your own idea of a better message. An already-approved draft can still be edited when the user asks for the change - doing so returns it to an unapproved draft, so say the old approval no longer covers the new wording and it must be re-approved before it can be saved to Gmail. A dismissed or already-sent draft cannot be edited at all, and the attempt is refused. This is an internal, text-only edit: an unapproved draft remains an unapproved Tendnote draft; it is never ready to send, an external or Gmail draft, or sent. Nothing is approved, exported, or sent by this call, and saving to Gmail is still `save_draft_to_gmail` with its own approval gate. Returns the updated draft reference; say what you changed, briefly.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const outcome = await withModelSafeStoreErrors(() =>
      editDraftBody({ ownerUserId, draftId: input.draftId, body: input.body }),
    );
    await requestBackgroundAffectedScopeReconciliation(outcome.affectedScopes);

    return {
      updated: true as const,
      draftId: outcome.result.id,
      // The status the draft still holds. It travels so the model can see that an
      // edit did not approve anything, which is the claim it is most likely to make.
      status: outcome.result.status,
      channel: outcome.result.channel,
      purpose: outcome.result.purpose,
    };
  },
  /**
   * The body does not travel back: the model just wrote it, and echoing it invites a
   * reply that reprints the whole message the person page already shows.
   */
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        updated: true,
        draftId: output.draftId,
        status: output.status,
        requiredResponse:
          output.status === "approved"
            ? DRAFT_REVISION_REPLY_CANONICAL.approved
            : DRAFT_REVISION_REPLY_CANONICAL.draft,
        guidance:
          output.status === "approved"
            ? "Reply with requiredResponse exactly and add nothing else. It states that the prior approval no longer covers this wording and that nothing was exported or sent. `draftId` stays the handle for later calls; never write it in your reply."
            : "Reply with requiredResponse exactly and add nothing else. It states that the internal Tendnote draft remains an unapproved draft, nothing was approved, exported, or sent, and it is not an external or Gmail draft. `draftId` stays the handle for later calls; never write it in your reply.",
      },
    };
  },
});
