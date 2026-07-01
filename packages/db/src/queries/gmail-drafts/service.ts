import {
  findLinkedGmailDraftAction,
  GMAIL_CAPABILITY_KEY,
  GMAIL_PROVIDER_KEY,
  type GmailDraftAction,
  type GmailDraftActionKind,
  type GmailDraftActionStatus,
  type GmailDraftApproval,
  type GmailDraftRecipient,
  gmailDraftApprovalSchema,
} from "@tendnote/domain";
import type {
  GmailDraftActionStore,
  GmailDraftAdapter,
  GmailDraftAuthorize,
  GmailDraftBodySource,
} from "./types";

const ENTITY_TYPE = "gmail_draft_action";
const MAX_ERROR_LENGTH = 1000;

/** Input to externalize an approved Tendnote draft as a Gmail draft (create/update). */
export type GmailDraftWriteInput = {
  ownerUserId: string;
  messageDraftId: string;
  subject: string;
  recipient: GmailDraftRecipient;
  /**
   * Dedupe key for this approved submission (PRD story 38). A retried or refreshed
   * submission with the same key returns the prior action instead of writing Gmail
   * again. It identifies ONE submission of ONE operation: reusing a create's key on
   * an update (or vice versa) is rejected rather than silently skipped. Callers
   * should also reuse the same key when re-submitting after a lost response so a
   * keyless provider create is not duplicated. Unique per owner.
   */
  idempotencyKey: string;
};

export type GmailDraftRetryInput = {
  ownerUserId: string;
  actionId: string;
};

/**
 * Result of an external Gmail write attempt.
 *
 * - `succeeded`/`failed` carry the durable action record (failed is retryable).
 * - `blocked` is a precondition refusal (Gmail not connected, missing approval,
 *   duplicate create, or nothing to update): no external draft exists, nothing is
 *   retryable at the action level, and the Tendnote draft is left intact (ADR-0091).
 */
export type GmailDraftActionOutcome =
  | { status: "succeeded"; action: GmailDraftAction }
  | { status: "failed"; action: GmailDraftAction }
  | { status: "blocked"; reason: string };

export type GmailDraftServiceDeps = {
  store: GmailDraftActionStore;
  adapter: GmailDraftAdapter;
  drafts: GmailDraftBodySource;
  /** Precondition gate; defaults to allow (see `GmailDraftAuthorize`). */
  authorize?: GmailDraftAuthorize;
};

/**
 * Shared owner-scoped Gmail draft action service (PRD #119, ADR-0083, ADR-0084).
 *
 * This is the single seam web (#122) and Eve (#124) call to create or update Gmail
 * drafts, so external-write policy never forks between surfaces. It composes the
 * durable action store, an injectable Gmail adapter, the Tendnote draft body source
 * of truth (ADR-0086), and a precondition gate (connection + approval), and it
 * enforces idempotency, records visible failed/retryable state, and never mutates
 * the Tendnote draft.
 *
 * Owner scoping: every store read/write is keyed by `ownerUserId`, so one owner can
 * never see or write another's external-action state.
 */
export function createGmailDraftService(deps: GmailDraftServiceDeps) {
  const { store, adapter, drafts } = deps;
  const authorize: GmailDraftAuthorize = deps.authorize ?? (async () => ({ ok: true }));

  async function loadApprovedBody(input: {
    ownerUserId: string;
    messageDraftId: string;
  }): Promise<string> {
    const draft = await drafts.getDraftBody(input);
    if (!draft) {
      throw new Error("Message draft not found.");
    }
    const body = draft.body.trim();
    if (!body) {
      throw new Error("Cannot create a Gmail draft from an empty Tendnote draft body.");
    }
    return body;
  }

  function nextVersion(actions: GmailDraftAction[]): number {
    return actions.reduce((max, action) => Math.max(max, action.version), 0) + 1;
  }

  /**
   * Idempotency short-circuit for a fresh write. Returns the prior action's outcome
   * when the same submission is retried; rejects a key reused for a different
   * operation so an update can never silently return a stale create (or vice versa).
   */
  async function priorOutcomeForKey(input: {
    ownerUserId: string;
    idempotencyKey: string;
    kind: GmailDraftActionKind;
  }): Promise<GmailDraftActionOutcome | null> {
    const prior = await store.findByIdempotencyKey({
      ownerUserId: input.ownerUserId,
      idempotencyKey: input.idempotencyKey,
    });
    if (!prior) {
      return null;
    }
    if (prior.kind !== input.kind) {
      throw new Error("This idempotency key was already used for a different Gmail draft action.");
    }
    return outcomeOf(prior);
  }

  /** Persist one completed attempt as a durable action row and audit it. */
  async function recordAttempt(input: {
    ownerUserId: string;
    messageDraftId: string;
    kind: GmailDraftActionKind;
    status: GmailDraftActionStatus;
    approval: GmailDraftApproval;
    gmailDraftId: string | null;
    version: number;
    idempotencyKey: string;
    lastErrorMessage: string | null;
  }): Promise<GmailDraftAction> {
    const action = await store.createAction({
      ownerUserId: input.ownerUserId,
      messageDraftId: input.messageDraftId,
      providerKey: GMAIL_PROVIDER_KEY,
      capabilityKey: GMAIL_CAPABILITY_KEY,
      kind: input.kind,
      status: input.status,
      subject: input.approval.subject,
      recipient: input.approval.recipient,
      gmailDraftId: input.gmailDraftId,
      version: input.version,
      idempotencyKey: input.idempotencyKey,
      lastErrorMessage: input.lastErrorMessage,
    });
    await writeAudit(action, input.kind);
    return action;
  }

  async function writeAudit(action: GmailDraftAction, event: string) {
    try {
      await store.createAuditLogEntry({
        ownerUserId: action.ownerUserId,
        action: `${ENTITY_TYPE}.${event}`,
        entityType: ENTITY_TYPE,
        entityId: action.id,
        metadataJson: {
          messageDraftId: action.messageDraftId,
          kind: action.kind,
          status: action.status,
          gmailDraftId: action.gmailDraftId,
          version: action.version,
        },
      });
    } catch {
      // The action state is already persisted; an audit-log failure must not lose it.
    }
  }

  function outcomeOf(action: GmailDraftAction): GmailDraftActionOutcome {
    return action.status === "succeeded"
      ? { status: "succeeded", action }
      : { status: "failed", action };
  }

  return {
    /**
     * Create a Gmail draft from an approved Tendnote draft. Idempotent by
     * `idempotencyKey`; refuses a duplicate create once a Gmail draft already exists
     * for the draft (callers should update instead). The write uses the exact
     * persisted draft body (ADR-0086), so approval-flow edits must be written
     * through the draft lifecycle first.
     */
    async createGmailDraft(input: GmailDraftWriteInput): Promise<GmailDraftActionOutcome> {
      const approval = gmailDraftApprovalSchema.parse({
        subject: input.subject,
        recipient: input.recipient,
      });

      const prior = await priorOutcomeForKey({
        ownerUserId: input.ownerUserId,
        idempotencyKey: input.idempotencyKey,
        kind: "create",
      });
      if (prior) {
        return prior;
      }

      const existing = await store.listActionsForDraft({
        ownerUserId: input.ownerUserId,
        messageDraftId: input.messageDraftId,
      });
      if (findLinkedGmailDraftAction(existing)) {
        return {
          status: "blocked",
          reason: "A Gmail draft already exists for this Tendnote draft; update it instead.",
        };
      }

      const gate = await authorize({
        ownerUserId: input.ownerUserId,
        messageDraftId: input.messageDraftId,
        kind: "create",
        recipient: approval.recipient,
        subject: approval.subject,
      });
      if (!gate.ok) {
        return { status: "blocked", reason: gate.reason };
      }

      const body = await loadApprovedBody({
        ownerUserId: input.ownerUserId,
        messageDraftId: input.messageDraftId,
      });

      try {
        const result = await adapter.createDraft({
          ownerUserId: input.ownerUserId,
          to: approval.recipient.email,
          subject: approval.subject,
          body,
        });
        const action = await recordAttempt({
          ownerUserId: input.ownerUserId,
          messageDraftId: input.messageDraftId,
          kind: "create",
          status: "succeeded",
          approval,
          gmailDraftId: result.gmailDraftId,
          version: 1,
          idempotencyKey: input.idempotencyKey,
          lastErrorMessage: null,
        });
        return { status: "succeeded", action };
      } catch (error) {
        const action = await recordAttempt({
          ownerUserId: input.ownerUserId,
          messageDraftId: input.messageDraftId,
          kind: "create",
          status: "failed",
          approval,
          gmailDraftId: null,
          version: 1,
          idempotencyKey: input.idempotencyKey,
          lastErrorMessage: errorMessage(error),
        });
        return { status: "failed", action };
      }
    },

    /**
     * Update the existing Gmail draft linked to a Tendnote draft (ADR-0088). Targets
     * the stored Gmail draft id rather than creating a duplicate, and uses the exact
     * persisted draft body. Blocked when no Gmail draft exists yet for the draft.
     */
    async updateGmailDraft(input: GmailDraftWriteInput): Promise<GmailDraftActionOutcome> {
      const approval = gmailDraftApprovalSchema.parse({
        subject: input.subject,
        recipient: input.recipient,
      });

      const prior = await priorOutcomeForKey({
        ownerUserId: input.ownerUserId,
        idempotencyKey: input.idempotencyKey,
        kind: "update",
      });
      if (prior) {
        return prior;
      }

      const existing = await store.listActionsForDraft({
        ownerUserId: input.ownerUserId,
        messageDraftId: input.messageDraftId,
      });
      const target = findLinkedGmailDraftAction(existing);
      if (!target || target.gmailDraftId === null) {
        return {
          status: "blocked",
          reason: "No Gmail draft exists for this Tendnote draft yet; create one first.",
        };
      }

      const gate = await authorize({
        ownerUserId: input.ownerUserId,
        messageDraftId: input.messageDraftId,
        kind: "update",
        recipient: approval.recipient,
        subject: approval.subject,
      });
      if (!gate.ok) {
        return { status: "blocked", reason: gate.reason };
      }

      const body = await loadApprovedBody({
        ownerUserId: input.ownerUserId,
        messageDraftId: input.messageDraftId,
      });
      const version = nextVersion(existing);

      try {
        const result = await adapter.updateDraft({
          ownerUserId: input.ownerUserId,
          to: approval.recipient.email,
          subject: approval.subject,
          body,
          gmailDraftId: target.gmailDraftId,
        });
        const action = await recordAttempt({
          ownerUserId: input.ownerUserId,
          messageDraftId: input.messageDraftId,
          kind: "update",
          status: "succeeded",
          approval,
          gmailDraftId: result.gmailDraftId,
          version,
          idempotencyKey: input.idempotencyKey,
          lastErrorMessage: null,
        });
        return { status: "succeeded", action };
      } catch (error) {
        const action = await recordAttempt({
          ownerUserId: input.ownerUserId,
          messageDraftId: input.messageDraftId,
          kind: "update",
          status: "failed",
          approval,
          // Keep the target id so an explicit retry can re-attempt the same draft.
          gmailDraftId: target.gmailDraftId,
          version,
          idempotencyKey: input.idempotencyKey,
          lastErrorMessage: errorMessage(error),
        });
        return { status: "failed", action };
      }
    },

    /**
     * Explicitly re-attempt a failed action (ADR-0091). Reuses the same durable row
     * (no duplicate external draft), re-reads the current draft body, and requires
     * the precondition gate to still pass. Never runs automatically in the
     * background — a caller must invoke it in response to a visible retry.
     */
    async retryGmailDraftAction(input: GmailDraftRetryInput): Promise<GmailDraftActionOutcome> {
      const action = await store.getAction({
        ownerUserId: input.ownerUserId,
        actionId: input.actionId,
      });
      if (!action) {
        throw new Error("Gmail draft action not found.");
      }
      if (action.status === "succeeded") {
        return { status: "succeeded", action };
      }

      const gate = await authorize({
        ownerUserId: action.ownerUserId,
        messageDraftId: action.messageDraftId,
        kind: action.kind,
        recipient: action.recipient,
        subject: action.subject,
      });
      if (!gate.ok) {
        return { status: "blocked", reason: gate.reason };
      }

      const body = await loadApprovedBody({
        ownerUserId: action.ownerUserId,
        messageDraftId: action.messageDraftId,
      });

      try {
        const result =
          action.kind === "create"
            ? await adapter.createDraft({
                ownerUserId: action.ownerUserId,
                to: action.recipient.email,
                subject: action.subject,
                body,
              })
            : await adapter.updateDraft({
                ownerUserId: action.ownerUserId,
                to: action.recipient.email,
                subject: action.subject,
                body,
                gmailDraftId: requireTarget(action),
              });
        const updated = await requireUpdate(
          store.updateAction({
            ownerUserId: action.ownerUserId,
            actionId: action.id,
            patch: {
              status: "succeeded",
              gmailDraftId: result.gmailDraftId,
              lastErrorMessage: null,
            },
          }),
        );
        await writeAudit(updated, "retry");
        return { status: "succeeded", action: updated };
      } catch (error) {
        const updated = await requireUpdate(
          store.updateAction({
            ownerUserId: action.ownerUserId,
            actionId: action.id,
            patch: { status: "failed", lastErrorMessage: errorMessage(error) },
          }),
        );
        await writeAudit(updated, "retry");
        return { status: "failed", action: updated };
      }
    },

    /** All of an owner's Gmail draft actions for one Tendnote draft, newest first. */
    listGmailDraftActionsForDraft(input: { ownerUserId: string; messageDraftId: string }) {
      return store.listActionsForDraft(input);
    },
  };
}

export type GmailDraftService = ReturnType<typeof createGmailDraftService>;

function requireTarget(action: GmailDraftAction): string {
  if (action.gmailDraftId === null) {
    throw new Error("Cannot retry a Gmail draft update without a stored Gmail draft id.");
  }
  return action.gmailDraftId;
}

async function requireUpdate(updated: Promise<GmailDraftAction | null>): Promise<GmailDraftAction> {
  const action = await updated;
  if (!action) {
    throw new Error("Gmail draft action not found.");
  }
  return action;
}

/** Cap a provider/transient error to a non-secret, bounded string (ADR-0094). */
function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}
