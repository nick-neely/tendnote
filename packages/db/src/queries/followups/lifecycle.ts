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

type ListActiveFollowupsInput = {
  ownerUserId: string;
  personId?: string;
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
    const followup =
      (await store.getFollowup({
        ownerUserId: input.actorUserId,
        followupId: input.followupId,
      })) ??
      (await store.getVisibleFollowup({
        callerUserId: input.actorUserId,
        followupId: input.followupId,
      }));

    if (!followup) {
      throw new Error("Follow-up not found.");
    }

    return followup;
  }

  /**
   * Owner must hold an active membership in the household a non-private follow-up is
   * scoped to. Private follow-ups need no household; a shared/household scope without a
   * household, or without an active membership, is rejected.
   */
  async function assertHouseholdMembership(
    ownerUserId: string,
    scope: "private" | "shared" | "household",
    householdId: string | null,
  ) {
    if (scope === "private") return;
    if (!householdId) {
      throw new Error("Shared follow-ups require a household.");
    }
    const membership = await store.getHouseholdMembership({ householdId, userId: ownerUserId });
    if (membership?.status !== "active") {
      throw new Error("Active household membership required.");
    }
  }

  /**
   * A `shared` follow-up must name at least one recipient, and every named recipient
   * must be an active member of the household. Non-shared scopes select no members.
   */
  async function assertSelectedMembers(
    scope: "private" | "shared" | "household",
    householdId: string | null,
    selectedUserIds: string[],
  ) {
    if (scope !== "shared") return;
    if (selectedUserIds.length === 0) {
      throw new Error("Select at least one household member to share this follow-up.");
    }
    if (!householdId) return;

    const activeMembers = await store.listHouseholdMemberships({ householdId, status: "active" });
    const activeUserIds = new Set(activeMembers.map((member) => member.userId));
    const invalidUserIds = selectedUserIds.filter((userId) => !activeUserIds.has(userId));
    if (invalidUserIds.length > 0) {
      throw new Error("Selected household members must be active.");
    }
  }

  /** Fan out household record shares for a shared follow-up to each selected member. */
  async function createFollowupShares(
    followup: { id: string },
    ownerUserId: string,
    householdId: string | null,
    scope: "private" | "shared" | "household",
    selectedUserIds: string[],
  ) {
    if (scope !== "shared" || !householdId) return;
    for (const selectedUserId of selectedUserIds) {
      await store.createHouseholdRecordShare({
        householdId,
        recordKind: "followup",
        recordId: followup.id,
        sharedWithUserId: selectedUserId,
        sharedByUserId: ownerUserId,
      });
    }
  }

  async function transition(input: FollowupActionInput, action: FollowupLifecycleAction) {
    const followup = await requireFollowup(input);
    const status = resolveFollowupTransition(followup.status, action);

    const updated = await store.updateFollowup({
      ownerUserId: followup.ownerUserId,
      followupId: followup.id,
      patch: { status, lastActorUserId: input.actorUserId },
    });

    await store.createAuditLogEntry({
      ownerUserId: followup.ownerUserId,
      action: `followup.${action}`,
      entityType: "followup",
      entityId: updated.id,
      metadataJson: {
        actorUserId: input.actorUserId,
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
      const scope = input.scope ?? "private";
      const householdId = scope === "private" ? null : (input.householdId ?? null);
      const selectedUserIds = input.selectedUserIds ?? [];

      await assertHouseholdMembership(input.ownerUserId, scope, householdId);
      await assertSelectedMembers(scope, householdId, selectedUserIds);

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
        householdId,
        scope,
        createdByUserId: input.ownerUserId,
        lastActorUserId: input.ownerUserId,
      });

      await createFollowupShares(followup, input.ownerUserId, householdId, scope, selectedUserIds);

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "followup.create",
        entityType: "followup",
        entityId: followup.id,
        metadataJson: {
          actorUserId: input.ownerUserId,
          householdId: followup.householdId,
          personId: followup.personId,
          scope: followup.scope,
          status: followup.status,
        },
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
      const active = await store.listVisibleActiveFollowups({
        callerUserId: input.ownerUserId,
        personId: input.personId,
        dueBefore: input.dueBefore,
        limit: input.limit,
      });

      return Promise.all(
        active.map(async (followup) => ({
          followup,
          person: await store.getPerson({
            ownerUserId: followup.ownerUserId,
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
        ownerUserId: followup.ownerUserId,
        followupId: followup.id,
        patch: { ...patch, lastActorUserId: input.actorUserId },
      });

      await store.createAuditLogEntry({
        ownerUserId: followup.ownerUserId,
        action: "followup.edit",
        entityType: "followup",
        entityId: updated.id,
        metadataJson: {
          actorUserId: input.actorUserId,
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
        ownerUserId: followup.ownerUserId,
        followupId: followup.id,
        patch: { status, dueAt, lastActorUserId: input.actorUserId },
      });

      await store.createAuditLogEntry({
        ownerUserId: followup.ownerUserId,
        action: "followup.snooze",
        entityType: "followup",
        entityId: updated.id,
        metadataJson: {
          actorUserId: input.actorUserId,
          personId: updated.personId,
          previousStatus: followup.status,
          status: updated.status,
        },
      });

      return updated;
    },
  };
}
