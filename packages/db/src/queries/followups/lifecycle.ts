import {
  assertConcreteDueAt,
  assertFollowupEditable,
  type FollowupLifecycleAction,
  followupEditSchema,
  resolveFollowupTransition,
} from "@tendnote/domain";
import type {
  ActiveFollowupSummary,
  CreateActiveFollowupInput,
  EditFollowupInput,
  FollowupActionInput,
  FollowupLifecycleStore,
  SnoozeFollowupInput,
} from "./types";

export type ListActiveFollowupsInput = {
  ownerUserId: string;
  dueBefore?: Date;
  limit?: number;
};

/**
 * Shared owner-scoped follow-up lifecycle (PRD #42, ADR-0007). This is the single
 * source of truth for creating and transitioning follow-ups: web routes/actions
 * and Eve tools are thin callers over these functions so product rules — owner
 * scoping, required concrete due dates, validated status transitions, and audit
 * logging — never fork between surfaces.
 *
 * `cadence` is inert metadata in Phase 1E: completing, snoozing, or editing a
 * follow-up never generates a next instance, so a reminder can never surprise the
 * user (ADR-0042).
 */
export function createFollowupLifecycle(store: FollowupLifecycleStore) {
  /** Loads an owner-scoped follow-up or throws so callers cannot touch another owner's. */
  async function requireFollowup(input: FollowupActionInput) {
    const followup = await store.getFollowup(input);

    if (!followup) {
      throw new Error("Follow-up not found.");
    }

    return followup;
  }

  async function transition(input: FollowupActionInput, action: FollowupLifecycleAction) {
    const followup = await requireFollowup(input);
    const status = resolveFollowupTransition(followup.status, action);

    const updated = await store.updateFollowup({
      ownerUserId: input.ownerUserId,
      followupId: followup.id,
      patch: { status },
    });

    await store.createAuditLogEntry({
      ownerUserId: input.ownerUserId,
      action: `followup.${action}`,
      entityType: "followup",
      entityId: updated.id,
      metadataJson: {
        personId: updated.personId,
        previousStatus: followup.status,
        status: updated.status,
      },
    });

    return updated;
  }

  return {
    /**
     * Creates a user-created follow-up as an active `open` reminder. Requires a
     * person the owner owns and a concrete due date — vague "someday" reminders
     * are rejected (PRD #42).
     */
    async createFollowup(input: CreateActiveFollowupInput) {
      const dueAt = assertConcreteDueAt(input.dueAt);

      const person = await store.getPerson({
        ownerUserId: input.ownerUserId,
        personId: input.personId,
      });

      if (!person) {
        throw new Error("Person not found.");
      }

      const followup = await store.createFollowup({
        ownerUserId: input.ownerUserId,
        personId: input.personId,
        reason: input.reason,
        dueAt,
        status: "open",
        cadence: input.cadence ?? null,
      });

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "followup.create",
        entityType: "followup",
        entityId: followup.id,
        metadataJson: { personId: followup.personId, status: followup.status },
      });

      return followup;
    },

    /**
     * Lists the owner's active reminders (open/snoozed) due-first, each paired
     * with its person for display. Powers the calm dashboard surface (#45):
     * archived, suggested, completed, and dismissed follow-ups are excluded, and
     * the person is resolved owner-scoped so surfaces name people, not raw ids.
     */
    async listActiveFollowups(input: ListActiveFollowupsInput): Promise<ActiveFollowupSummary[]> {
      const active = await store.listActiveFollowupsForOwner(input);

      return Promise.all(
        active.map(async (followup) => ({
          followup,
          person: await store.getPerson({
            ownerUserId: input.ownerUserId,
            personId: followup.personId,
          }),
        })),
      );
    },

    /** Edits a follow-up's reason and/or due date in place (no status change). */
    async editFollowup(input: EditFollowupInput) {
      const followup = await requireFollowup(input);

      assertFollowupEditable(followup.status);
      const edit = followupEditSchema.parse(input.edit);

      // A no-op edit would still write a misleading audit row, so require at
      // least one field to change.
      if (edit.reason === undefined && edit.dueAt === undefined) {
        throw new Error("A follow-up edit must change the reason or the due date.");
      }

      const patch: { reason?: string; dueAt?: Date } = {};
      if (edit.reason !== undefined) {
        patch.reason = edit.reason;
      }
      if (edit.dueAt !== undefined) {
        patch.dueAt = assertConcreteDueAt(edit.dueAt);
      }

      const updated = await store.updateFollowup({
        ownerUserId: input.ownerUserId,
        followupId: followup.id,
        patch,
      });

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "followup.edit",
        entityType: "followup",
        entityId: updated.id,
        metadataJson: {
          personId: updated.personId,
          editedReason: edit.reason !== undefined,
          editedDueAt: edit.dueAt !== undefined,
        },
      });

      return updated;
    },

    completeFollowup(input: FollowupActionInput) {
      return transition(input, "complete");
    },

    dismissFollowup(input: FollowupActionInput) {
      return transition(input, "dismiss");
    },

    reopenFollowup(input: FollowupActionInput) {
      return transition(input, "reopen");
    },

    archiveFollowup(input: FollowupActionInput) {
      return transition(input, "archive");
    },

    /** Snoozes an active follow-up to a new concrete due date. */
    async snoozeFollowup(input: SnoozeFollowupInput) {
      const dueAt = assertConcreteDueAt(input.dueAt);
      const followup = await requireFollowup(input);
      const status = resolveFollowupTransition(followup.status, "snooze");

      const updated = await store.updateFollowup({
        ownerUserId: input.ownerUserId,
        followupId: followup.id,
        patch: { status, dueAt },
      });

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "followup.snooze",
        entityType: "followup",
        entityId: updated.id,
        metadataJson: {
          personId: updated.personId,
          previousStatus: followup.status,
          status: updated.status,
        },
      });

      return updated;
    },
  };
}
