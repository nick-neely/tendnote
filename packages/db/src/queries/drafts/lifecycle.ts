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

    const updated = await store.updateDraft({
      ownerUserId: input.ownerUserId,
      draftId: draft.id,
      patch: { status },
    });

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

      const updated = await store.updateDraft({
        ownerUserId: input.ownerUserId,
        draftId: draft.id,
        patch: { body },
      });

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "message_draft.edit",
        entityType: "message_draft",
        entityId: updated.id,
        metadataJson: { personId: updated.personId },
      });

      return updated;
    },
  };
}
