import {
  assertMessageDraftEditable,
  type MessageDraft,
  type MessageDraftAction,
  MessageDraftValidationError,
  resolveMessageDraftTransition,
} from "@tendnote/domain";
import type { DraftLifecycleStore } from "./types";

export type DraftActionInput = {
  ownerUserId: string;
  draftId: string;
};

export type EditDraftBodyInput = DraftActionInput & {
  body: string;
};

/**
 * Shared owner-scoped draft lifecycle (PRD #75, issue #78, ADR-0014). This is the
 * single source of truth for transitioning and editing persisted drafts: the web
 * review surface and Eve are thin callers, so owner scoping, validated status
 * transitions, body-edit rules, and audit logging never fork between surfaces.
 *
 * Every action is internal to Tendnote. `markSentManually` records only that the
 * user sent the message themselves; it never sends or creates anything externally
 * (PRD user story #10). Lifecycle actions never mutate the underlying memories,
 * source records, follow-ups, or brief items, and editing the body always
 * preserves the persisted source-reference grounding contract (PRD user story #7).
 */
export function createDraftLifecycle(store: DraftLifecycleStore) {
  async function requireDraft(input: DraftActionInput): Promise<MessageDraft> {
    const draft = await store.getDraft(input);

    // Deliberately a bare `Error`, unlike the state refusals below: a missing
    // record reaches a model as an invitation to guess another id, and the opaque
    // store sentence is the one that tells it to stop instead
    // (`apps/agent/agent/lib/store-errors.ts`).
    if (!draft) {
      throw new Error("Message draft not found.");
    }

    return draft;
  }

  async function transition(
    input: DraftActionInput,
    action: MessageDraftAction,
  ): Promise<MessageDraft> {
    const draft = await requireDraft(input);
    const status = resolveMessageDraftTransition(draft.status, action);

    // Only `approve` authorizes an external Gmail export, so only it needs the
    // optimistic-concurrency guard: the write flips to `approved` ONLY IF the
    // persisted body still equals the body this transition just read. If a
    // concurrent `editDraftBody` changed the body between that read and this write,
    // approving unconditionally would stamp authorization onto text the user never
    // reviewed (the shared Gmail gate authorizes on `status === "approved"` and the
    // service reads the CURRENT body). The guard is applied atomically INSIDE the
    // store's single UPDATE (`expectedBody`); on a body mismatch the store matches no
    // row and returns null, and we refuse below without writing an audit entry.
    //
    // `dismiss`/`mark_sent_manually` authorize nothing external, so they write
    // unconditionally exactly as before and can never return null here.
    const updated =
      action === "approve"
        ? await store.updateDraft({
            ownerUserId: input.ownerUserId,
            draftId: draft.id,
            patch: { status },
            expectedBody: draft.body,
          })
        : await store.updateDraft({
            ownerUserId: input.ownerUserId,
            draftId: draft.id,
            patch: { status },
          });

    if (!updated) {
      // Reachable only on the guarded `approve` path: the row exists (requireDraft
      // passed) but its body changed since we read it. A state refusal, not a
      // not-found — the record is fine, it simply moved on and must be re-reviewed
      // before approval can authorize an export. Rendered to the model as itself
      // (a curated domain failure), unlike the opaque not-found sentinel.
      throw new MessageDraftValidationError(
        "This draft changed since it was read and cannot be approved. Review the current wording and approve it again.",
      );
    }

    await store.createAuditLogEntry({
      ownerUserId: input.ownerUserId,
      action: `message_draft.${action}`,
      entityType: "message_draft",
      entityId: updated.id,
      metadataJson: {
        personId: updated.personId,
        previousStatus: draft.status,
        status: updated.status,
      },
    });

    return updated;
  }

  return {
    /** Marks an internal readiness approval (not an external send). */
    approveDraft(input: DraftActionInput) {
      return transition(input, "approve");
    },

    /** Clears a low-quality draft from the workspace. */
    dismissDraft(input: DraftActionInput) {
      return transition(input, "dismiss");
    },

    /** Records that the user sent the message themselves; Tendnote sent nothing. */
    markDraftSentManually(input: DraftActionInput) {
      return transition(input, "mark_sent_manually");
    },

    /**
     * Edits the draft body in place. The persisted source-reference grounding is
     * never touched, so the draft stays explainable after the user rewrites it.
     *
     * Editing an APPROVED draft revokes the approval atomically: the same write that
     * replaces the body also returns the status to `draft`. Approval is readiness for
     * the exact text the user reviewed, and the shared Gmail gate authorizes an
     * external write purely on `status === "approved"` while the Gmail service reads
     * the CURRENT persisted body — so without this revert, a revised (unapproved) body
     * could be exported to Gmail on the strength of the prior approval (a stale
     * authorization a prompt injection could exploit). Reverting forces the user to
     * re-approve the new wording before it can leave Tendnote.
     */
    async editDraftBody(input: EditDraftBodyInput): Promise<MessageDraft> {
      const draft = await requireDraft(input);
      assertMessageDraftEditable(draft.status);

      const body = input.body.trim();
      if (!body) {
        throw new MessageDraftValidationError("A draft body cannot be empty.");
      }
      if (body === draft.body) {
        throw new MessageDraftValidationError("A draft edit must change the body.");
      }

      // The reversion is decided ATOMICALLY by the store from the row's current
      // status (`revertApprovalToDraft`), not from `draft.status` above: that read
      // is stale, so authorizing off it would let an approval committed concurrently
      // between the read and this write survive the edit and export unreviewed text.
      const updated = await store.updateDraft({
        ownerUserId: input.ownerUserId,
        draftId: draft.id,
        patch: { body },
        revertApprovalToDraft: true,
      });

      // Audit only — not an authorization decision. The store already reverted (or
      // not); we record the transition when the RETURNED status shows it happened.
      const revokedApproval = draft.status === "approved" && updated.status === "draft";

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "message_draft.edit",
        entityType: "message_draft",
        entityId: updated.id,
        metadataJson: revokedApproval
          ? {
              personId: updated.personId,
              previousStatus: draft.status,
              status: updated.status,
            }
          : { personId: updated.personId },
      });

      return updated;
    },
  };
}
