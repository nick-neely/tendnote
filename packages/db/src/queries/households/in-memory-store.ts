import { randomUUID } from "node:crypto";
import {
  createHouseholdMembershipSchema,
  createHouseholdWorkspaceSchema,
  type HouseholdMembership,
  type HouseholdWorkspace,
  householdMembershipSchema,
} from "@tendnote/domain";
import type {
  HouseholdAuditLogEntry,
  HouseholdDissolutionConfirmation,
  HouseholdRecordShare,
  HouseholdStore,
} from "./types";

export function createInMemoryHouseholdStore(): HouseholdStore & {
  listAuditLogEntries: (input: { ownerUserId: string }) => Promise<HouseholdAuditLogEntry[]>;
} {
  const households = new Map<string, HouseholdWorkspace>();
  const memberships = new Map<string, HouseholdMembership>();
  const recordShares = new Map<string, HouseholdRecordShare>();
  const dissolutionConfirmations = new Map<string, HouseholdDissolutionConfirmation>();
  const auditLogEntries: HouseholdAuditLogEntry[] = [];

  return {
    async createHouseholdWorkspace(input) {
      // No one-workspace-per-creator guard: `owner_user_id` is history, and the
      // one-active-household rule is a membership rule enforced by
      // `assertHouseholdAdmissionAvailable`. Refusing here would mean someone
      // whose household was dissolved could never start another.
      const parsed = createHouseholdWorkspaceSchema.parse(input);
      const now = new Date();
      const household: HouseholdWorkspace = {
        ...parsed,
        id: randomUUID(),
        status: "active",
        dissolvedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      households.set(household.id, household);
      return household;
    },
    async getHouseholdWorkspace(input) {
      return households.get(input.householdId) ?? null;
    },
    async getHouseholdWorkspaces(input) {
      const householdIds = new Set(input.householdIds);
      return [...households.values()].filter((household) => householdIds.has(household.id));
    },
    async updateHouseholdWorkspace(input) {
      const household = households.get(input.householdId);
      if (!household) {
        throw new Error("Household workspace not found.");
      }
      const updated = { ...household, ...input.patch, updatedAt: new Date() };
      households.set(updated.id, updated);
      return updated;
    },
    async createHouseholdMembership(input) {
      const parsed = createHouseholdMembershipSchema.parse(input);
      const duplicate = [...memberships.values()].find(
        (membership) =>
          membership.householdId === parsed.householdId && membership.userId === parsed.userId,
      );
      if (duplicate) {
        throw new Error("Household membership already exists.");
      }

      const now = new Date();
      const membership: HouseholdMembership = {
        ...parsed,
        id: randomUUID(),
        pendingRole: null,
        pendingRoleOfferedByUserId: null,
        pendingRoleOfferedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      memberships.set(membership.id, membership);
      return membership;
    },
    async getHouseholdMembership(input) {
      return (
        [...memberships.values()].find(
          (membership) =>
            membership.householdId === input.householdId && membership.userId === input.userId,
        ) ?? null
      );
    },
    async getHouseholdMembershipById(input) {
      return memberships.get(input.membershipId) ?? null;
    },
    async updateHouseholdMembership(input) {
      const membership = memberships.get(input.membershipId);
      if (!membership) {
        throw new Error("Household membership not found.");
      }

      const updated = householdMembershipSchema.parse({
        ...membership,
        ...input.patch,
        updatedAt: new Date(),
      });
      memberships.set(updated.id, updated);
      return updated;
    },
    async listHouseholdMemberships(input) {
      return [...memberships.values()].filter(
        (membership) =>
          membership.householdId === input.householdId &&
          (input.status === undefined || membership.status === input.status),
      );
    },
    async listActiveHouseholdMembershipsForUser(input) {
      return [...memberships.values()].filter(
        (membership) => membership.userId === input.userId && membership.status === "active",
      );
    },
    async createHouseholdRecordShare(input) {
      const existing = [...recordShares.values()].find(
        (share) =>
          share.recordKind === input.recordKind &&
          share.recordId === input.recordId &&
          share.sharedWithUserId === input.sharedWithUserId,
      );
      if (existing) {
        return existing;
      }

      const share: HouseholdRecordShare = { ...input, id: randomUUID(), createdAt: new Date() };
      recordShares.set(share.id, share);
      return share;
    },
    async listHouseholdRecordShares(input) {
      return [...recordShares.values()].filter(
        (share) =>
          share.householdId === input.householdId &&
          share.recordKind === input.recordKind &&
          share.recordId === input.recordId,
      );
    },
    async listHouseholdRecordSharesForRecords(input) {
      const householdIds = new Set(input.householdIds);
      const recordIds = new Set(input.recordIds);
      return [...recordShares.values()].filter(
        (share) =>
          householdIds.has(share.householdId) &&
          share.recordKind === input.recordKind &&
          recordIds.has(share.recordId),
      );
    },
    async deleteHouseholdRecordShares(input) {
      for (const [id, share] of recordShares) {
        if (
          share.householdId === input.householdId &&
          share.recordKind === input.recordKind &&
          share.recordId === input.recordId
        ) {
          recordShares.delete(id);
        }
      }
    },
    async deleteHouseholdRecordSharesForMember(input) {
      for (const [id, share] of recordShares) {
        if (share.householdId !== input.householdId) continue;
        if (
          !input.userId ||
          share.sharedWithUserId === input.userId ||
          share.sharedByUserId === input.userId
        ) {
          recordShares.delete(id);
        }
      }
    },
    async listHouseholdDissolutionConfirmations(input) {
      return [...dissolutionConfirmations.values()].filter(
        (confirmation) => confirmation.householdId === input.householdId,
      );
    },
    async confirmHouseholdDissolution(input) {
      const confirmation = {
        householdId: input.householdId,
        userId: input.userId,
        confirmedAt: new Date(),
      };
      dissolutionConfirmations.set(`${input.householdId}:${input.userId}`, confirmation);
      return confirmation;
    },
    async clearHouseholdDissolutionConfirmations(input) {
      for (const [key, confirmation] of dissolutionConfirmations) {
        if (confirmation.householdId !== input.householdId) continue;
        if (!input.userId || confirmation.userId === input.userId) {
          dissolutionConfirmations.delete(key);
        }
      }
    },
    async createAuditLogEntry(input) {
      const entry: HouseholdAuditLogEntry = { ...input, id: randomUUID(), createdAt: new Date() };
      auditLogEntries.push(entry);
      return entry;
    },
    async listAuditLogEntries(input) {
      return auditLogEntries.filter((entry) => entry.ownerUserId === input.ownerUserId);
    },
  };
}
