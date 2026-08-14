import { editDraftBody } from "@tendnote/db/queries/drafts";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { requestBackgroundAffectedScopeReconciliation } from "../lib/request-affected-scope-reconciliation";
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
 * The draft's status is untouched by construction: the shared lifecycle's body edit
 * writes the body and an audit line, and every transition (approve, dismiss, mark sent
 * manually) is a different call. An approved draft is not editable at all - the seam
 * refuses it - which is what keeps "the user approved this text" a statement about the
 * text they actually approved.
 *
 * Nothing here sends. `save_draft_to_gmail` remains the only path out of Tendnote and
 * still runs the same explicit approval gate the web surface does (ADR 0092).
 */
export default defineTool({
  description:
    "Rewrite the body of one of the user's existing Tendnote message drafts, when they ask for a change in the current turn ('make it shorter', 'take out the bit about the move', 'warmer opening'). Requires a draftId from `list_message_drafts` or from creating it. Send the COMPLETE new text: start from what the draft says now and apply only what they asked for this turn - never regenerate the message from scratch, never quietly improve wording they did not mention, and never fold in facts they did not ask you to add. Do NOT use this to write a new draft (`create_message_draft`), to act on your own idea of a better message, or to change a draft the user has already approved - approved text is theirs, and it is refused here. This changes text only: it does not approve, dismiss, send, or export anything, and saving to Gmail is still `save_draft_to_gmail` with its own approval gate. Returns the updated draft reference; say what you changed, briefly.",
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
        guidance:
          "The draft now says what you sent. Confirm the change in one short line rather " +
          "than reprinting the message. Nothing was approved, sent, or exported - the " +
          "status above is unchanged by this edit - and `draftId` stays the handle for " +
          "later calls; never write it in your reply.",
      },
    };
  },
});
