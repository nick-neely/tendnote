import {
  assertConcreteDueAt,
  assertFollowupEditable,
  birthdayAnnualFollowupCadence,
  type Followup,
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

type SearchFollowupsInput = {
  ownerUserId: string;
  includeArchived?: boolean;
  limit?: number;
};

/**
 * Shared owner-scoped follow-up lifecycle (PRD #42, ADR-0007). This is the single
 * source of truth for creating and transitioning follow-ups: web routes/actions
 * and Eve tools are thin callers over these functions so product rules — owner
 * scoping, required concrete due dates, validated status transitions, and audit
 * logging — never fork between surfaces.
 *
 * Ordinary `cadence` remains inert metadata. The one exception is the explicit
 * Birthday Follow-Up marker: completing that owner-created annual occurrence
 * advances the same record to its next year so no hidden sibling is generated.
 */
export function createFollowupLifecycle(store: FollowupLifecycleStore) {
  /**
   * READ resolution: an owner-scoped follow-up, falling back to any follow-up the
   * caller may *see* (a shared/household record). Visibility is enough to read, so
   * this backs the read-only `getFollowup`. It must never back a mutation — a
   * non-owner who can see a shared Follow-Up must not be able to change it.
   */
  async function requireVisibleFollowup(input: FollowupActionInput) {
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
   * MUTATION resolution: only the record owner may change a Follow-Up's lifecycle,
   * timing, content, or archive state. Shared Follow-Ups are read-only to non-owners
   * (household policy), so every mutation resolves owner-scoped. A missing record and
   * one the caller can see but does not own return the *same* opaque "not found" — a
   * non-owner learns nothing about a record they may not touch.
   */
  async function requireOwnedFollowup(input: FollowupActionInput) {
    const followup = await store.getFollowup({
      ownerUserId: input.actorUserId,
      followupId: input.followupId,
    });

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
    const followup = await requireOwnedFollowup(input);
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

      const sourceRecordId = input.sourceRecordId ?? null;
      if (sourceRecordId) {
        const source = await store.getSourceRecord({
          ownerUserId: input.ownerUserId,
          sourceRecordId,
        });
        if (!source) {
          throw new Error("Source record not found.");
        }
      }

      const followup = await store.createFollowup({
        id: input.id,
        ownerUserId: input.ownerUserId,
        personId: input.personId,
        reason: input.reason,
        dueAt,
        status: "open",
        cadence: input.cadence ?? null,
        sourceRecordId,
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
          grounded: sourceRecordId !== null,
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

    async searchFollowups(input: SearchFollowupsInput): Promise<ActiveFollowupSummary[]> {
      const visible = await store.listVisibleFollowups({
        callerUserId: input.ownerUserId,
        includeArchived: input.includeArchived ?? false,
        limit: input.limit,
      });
      return Promise.all(
        visible.map(async (followup) => ({
          followup,
          person: await store.getPerson({
            ownerUserId: followup.ownerUserId,
            personId: followup.personId,
          }),
        })),
      );
    },

    async getFollowup(input: FollowupActionInput) {
      return requireVisibleFollowup(input);
    },

    /** Edits a follow-up's reason and/or due date in place (no status change). */
    async editFollowup(input: EditFollowupInput) {
      const followup = await requireOwnedFollowup(input);

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

    async completeFollowup(input: FollowupActionInput) {
      const followup = await requireOwnedFollowup(input);
      resolveFollowupTransition(followup.status, "complete");
      if (followup.cadence !== birthdayAnnualFollowupCadence) {
        return transition(input, "complete");
      }
      const dueAt = nextAnnualDueAt(followup.dueAt, new Date());
      const updated = await store.updateFollowup({
        ownerUserId: followup.ownerUserId,
        followupId: followup.id,
        patch: { status: "open", dueAt, lastActorUserId: input.actorUserId },
      });
      await store.createAuditLogEntry({
        ownerUserId: followup.ownerUserId,
        action: "followup.complete",
        entityType: "followup",
        entityId: updated.id,
        metadataJson: {
          actorUserId: input.actorUserId,
          personId: updated.personId,
          previousStatus: followup.status,
          status: updated.status,
          annualOccurrenceAdvanced: true,
        },
      });
      return updated;
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

    /** Restores the exact pre-archive lifecycle state for the bounded Undo path. */
    async restoreArchivedFollowup(input: FollowupActionInput) {
      const followup = await requireOwnedFollowup(input);
      if (followup.status !== "archived") {
        throw new Error("Only archived follow-ups can be restored.");
      }
      const audit = await store.listAuditLogEntries({ ownerUserId: followup.ownerUserId });
      const archive = audit
        .filter((entry) => entry.entityType === "followup" && entry.entityId === followup.id)
        .at(-1);
      const previousStatus = archive?.metadataJson.previousStatus;
      if (
        archive?.action !== "followup.archive" ||
        typeof previousStatus !== "string" ||
        previousStatus === "archived"
      ) {
        throw new Error("This follow-up can no longer be restored from its archive.");
      }
      resolveFollowupTransition(previousStatus as Followup["status"], "archive");
      const updated = await store.updateFollowup({
        ownerUserId: followup.ownerUserId,
        followupId: followup.id,
        patch: { status: previousStatus as Followup["status"], lastActorUserId: input.actorUserId },
      });
      await store.createAuditLogEntry({
        ownerUserId: updated.ownerUserId,
        action: "followup.archive_restore",
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

    /** Snoozes an active follow-up to a new concrete due date. */
    async snoozeFollowup(input: SnoozeFollowupInput) {
      const dueAt = assertConcreteDueAt(input.dueAt);
      const followup = await requireOwnedFollowup(input);
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

function nextAnnualDueAt(dueAt: Date, now: Date): Date {
  const next = new Date(dueAt);
  do {
    next.setUTCFullYear(next.getUTCFullYear() + 1);
  } while (next.getTime() <= now.getTime());
  return next;
}
