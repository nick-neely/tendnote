import { assertHouseholdOwner } from "@tendnote/domain";
import type {
  AcceptHouseholdInviteInput,
  CreateHouseholdInput,
  HouseholdStore,
  InviteHouseholdMemberInput,
  RemoveHouseholdMemberInput,
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

  return {
    async createHousehold(input: CreateHouseholdInput) {
      const household = await store.createHouseholdWorkspace({
        ownerUserId: input.ownerUserId,
        name: input.name,
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
        metadataJson: { ownerMembershipId: ownerMembership.id },
      });

      return { household, ownerMembership };
    },

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
  };
}
