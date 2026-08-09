import {
  assertHouseholdAdmissionAvailable,
  assertHouseholdOwner,
  canViewScopedRecord,
  parseHouseholdName,
  scopedRecordVisibility,
} from "@tendnote/domain";
import type {
  AcceptHouseholdInviteInput,
  CanViewHouseholdRecordInput,
  CreateHouseholdInput,
  HouseholdStore,
  InviteHouseholdMemberInput,
  RemoveHouseholdMemberInput,
  ShareHouseholdRecordInput,
} from "./types";

export function createHouseholdLifecycle(store: HouseholdStore) {
  async function requireOwner(input: { ownerUserId: string; householdId: string }) {
    const membership = await store.getHouseholdMembership({
      householdId: input.householdId,
      userId: input.ownerUserId,
    });
    if (!membership) {
      throw new Error("Household membership not found.");
    }
    assertHouseholdOwner(membership);
    return membership;
  }

  async function requireActiveMember(input: { actorUserId: string; householdId: string }) {
    const membership = await store.getHouseholdMembership({
      householdId: input.householdId,
      userId: input.actorUserId,
    });
    if (membership?.status !== "active") {
      throw new Error("Active household membership required.");
    }
    return membership;
  }

  return {
    /**
     * Creates one immediately active workspace whose creator is its sole active
     * Owner. Admission is checked against the creator's own active memberships
     * first, so the one-active-workspace promise is decided here rather than by
     * whichever row a later reader happens to pick.
     */
    async createHousehold(input: CreateHouseholdInput) {
      const name = parseHouseholdName(input.name);
      assertHouseholdAdmissionAvailable(
        await store.listActiveHouseholdMembershipsForUser({ userId: input.ownerUserId }),
      );

      const household = await store.createHouseholdWorkspace({
        ownerUserId: input.ownerUserId,
        name,
        defaultScope: input.defaultScope ?? "private",
      });
      const ownerMembership = await store.createHouseholdMembership({
        householdId: household.id,
        userId: input.ownerUserId,
        invitedByUserId: input.ownerUserId,
        role: "owner",
        status: "active",
        invitedAt: new Date(),
        acceptedAt: new Date(),
        removedAt: null,
      });

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "household.create",
        entityType: "household",
        entityId: household.id,
        metadataJson: {
          ownerMembershipId: ownerMembership.id,
          name: household.name,
          role: ownerMembership.role,
          status: ownerMembership.status,
        },
      });

      return { household, ownerMembership };
    },

    /**
     * The pre-Phase-Eight direct-membership path: it takes an existing Tendnote
     * user id, writes an `invited` membership row, sends nothing, and consumes
     * no seat.
     *
     * It is **not** the Household Invitation model (ADR 0213), and nothing a
     * user can reach calls it — the shipped path is
     * `createHouseholdInvitationLifecycle`, whose capability is bound to an
     * email address, expires, and creates a membership only at acceptance. This
     * pair survives as fast test seeding for suites that need a two-member
     * household without an invitation round trip.
     */
    async inviteMember(input: InviteHouseholdMemberInput) {
      await requireOwner(input);

      if (input.invitedUserId === input.ownerUserId) {
        throw new Error("Cannot invite the household owner as a member.");
      }

      const membership = await store.createHouseholdMembership({
        householdId: input.householdId,
        userId: input.invitedUserId,
        invitedByUserId: input.ownerUserId,
        role: input.role ?? "member",
        status: "invited",
        invitedAt: new Date(),
        acceptedAt: null,
        removedAt: null,
      });

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "household.member_invite",
        entityType: "household_membership",
        entityId: membership.id,
        metadataJson: {
          householdId: input.householdId,
          invitedUserId: input.invitedUserId,
          role: membership.role,
          status: membership.status,
        },
      });

      return membership;
    },

    async acceptInvite(input: AcceptHouseholdInviteInput) {
      const membership = await store.getHouseholdMembership(input);
      if (membership?.status !== "invited") {
        throw new Error("Household invite not found.");
      }

      const updated = await store.updateHouseholdMembership({
        membershipId: membership.id,
        patch: { status: "active", acceptedAt: new Date() },
      });

      await store.createAuditLogEntry({
        ownerUserId: updated.invitedByUserId,
        action: "household.member_accept",
        entityType: "household_membership",
        entityId: updated.id,
        metadataJson: { householdId: updated.householdId, userId: updated.userId },
      });

      return updated;
    },

    async removeMember(input: RemoveHouseholdMemberInput) {
      await requireOwner(input);

      if (input.memberUserId === input.ownerUserId) {
        throw new Error("Household owner removal is not supported in Phase 4.");
      }

      const membership = await store.getHouseholdMembership({
        householdId: input.householdId,
        userId: input.memberUserId,
      });
      if (!membership || membership.status === "removed") {
        throw new Error("Active household member not found.");
      }

      const updated = await store.updateHouseholdMembership({
        membershipId: membership.id,
        patch: { status: "removed", removedAt: new Date() },
      });

      await store.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "household.member_remove",
        entityType: "household_membership",
        entityId: updated.id,
        metadataJson: {
          householdId: input.householdId,
          removedUserId: input.memberUserId,
          previousStatus: membership.status,
          status: updated.status,
        },
      });

      return updated;
    },

    listMembers(input: { ownerUserId: string; householdId: string }) {
      return requireOwner(input).then(() => store.listHouseholdMemberships(input));
    },

    listActiveMembershipsForUser(input: { userId: string }) {
      return store.listActiveHouseholdMembershipsForUser(input);
    },

    async shareRecordWithSelectedMembers(input: ShareHouseholdRecordInput) {
      await requireActiveMember(input);

      const activeMembers = await store.listHouseholdMemberships({
        householdId: input.householdId,
        status: "active",
      });
      const activeUserIds = new Set(activeMembers.map((member) => member.userId));
      const invalidUserIds = input.selectedUserIds.filter((userId) => !activeUserIds.has(userId));
      if (invalidUserIds.length > 0) {
        throw new Error("Selected household members must be active.");
      }

      const shares = [];
      for (const selectedUserId of input.selectedUserIds) {
        shares.push(
          await store.createHouseholdRecordShare({
            householdId: input.householdId,
            recordKind: input.recordKind,
            recordId: input.recordId,
            sharedWithUserId: selectedUserId,
            sharedByUserId: input.actorUserId,
          }),
        );
      }

      await store.createAuditLogEntry({
        ownerUserId: input.actorUserId,
        action: "household.record_share",
        entityType: input.recordKind,
        entityId: input.recordId,
        metadataJson: {
          householdId: input.householdId,
          selectedUserIds: input.selectedUserIds,
        },
      });

      return shares;
    },

    async canViewHouseholdRecord(input: CanViewHouseholdRecordInput) {
      const activeMemberships = input.householdId
        ? await store.listHouseholdMemberships({
            householdId: input.householdId,
            status: "active",
          })
        : [];
      const shares =
        input.scope === "shared" && input.householdId
          ? await store.listHouseholdRecordShares({
              householdId: input.householdId,
              recordKind: input.recordKind,
              recordId: input.recordId,
            })
          : [];

      return canViewScopedRecord({
        callerUserId: input.callerUserId,
        record: scopedRecordVisibility({
          ownerUserId: input.ownerUserId,
          scope: input.scope,
          householdId: input.householdId,
          shares,
        }),
        activeMemberships,
      });
    },
  };
}
