import { randomUUID } from "node:crypto";
import {
  createHouseholdMembershipSchema,
  createHouseholdWorkspaceSchema,
  type HouseholdMembership,
  type HouseholdWorkspace,
  householdMembershipSchema,
} from "@tendnote/domain";
import type { InMemoryMutationLog, InMemoryTransactionResource } from "./in-memory-transaction";
import { recordInMemoryMutation } from "./in-memory-transaction";
import type {
  HouseholdAuditLogEntry,
  HouseholdDissolutionConfirmation,
  HouseholdRecordShare,
  HouseholdStore,
} from "./types";

export function createInMemoryHouseholdStore(): HouseholdStore & {
  listAuditLogEntries: (input: { ownerUserId: string }) => Promise<HouseholdAuditLogEntry[]>;
  snapshot: () => {
    households: HouseholdWorkspace[];
    memberships: HouseholdMembership[];
    recordShares: HouseholdRecordShare[];
    dissolutionConfirmations: HouseholdDissolutionConfirmation[];
    auditLogEntries: HouseholdAuditLogEntry[];
  };
  restore: (
    snapshot: {
      households: HouseholdWorkspace[];
      memberships: HouseholdMembership[];
      recordShares: HouseholdRecordShare[];
      dissolutionConfirmations: HouseholdDissolutionConfirmation[];
      auditLogEntries: HouseholdAuditLogEntry[];
    },
    mutations?: InMemoryMutationLog,
  ) => void;
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
      recordInMemoryMutation("households", household.id);
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
      recordInMemoryMutation("households", updated.id);
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
      recordInMemoryMutation("memberships", membership.id);
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
      recordInMemoryMutation("memberships", updated.id);
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
      recordInMemoryMutation("recordShares", share.id);
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
          recordInMemoryMutation("recordShares", id);
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
          recordInMemoryMutation("recordShares", id);
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
      recordInMemoryMutation("dissolutionConfirmations", `${input.householdId}:${input.userId}`);
      dissolutionConfirmations.set(`${input.householdId}:${input.userId}`, confirmation);
      return confirmation;
    },
    async clearHouseholdDissolutionConfirmations(input) {
      for (const [key, confirmation] of dissolutionConfirmations) {
        if (confirmation.householdId !== input.householdId) continue;
        if (!input.userId || confirmation.userId === input.userId) {
          recordInMemoryMutation("dissolutionConfirmations", key);
          dissolutionConfirmations.delete(key);
        }
      }
    },
    async createAuditLogEntry(input) {
      const entry: HouseholdAuditLogEntry = { ...input, id: randomUUID(), createdAt: new Date() };
      recordInMemoryMutation("auditLogEntries", entry.id);
      auditLogEntries.push(entry);
      return entry;
    },
    async listAuditLogEntries(input) {
      return auditLogEntries.filter((entry) => entry.ownerUserId === input.ownerUserId);
    },
    snapshot() {
      return {
        households: [...households.values()].map((household) => ({ ...household })),
        memberships: [...memberships.values()].map((membership) => ({ ...membership })),
        recordShares: [...recordShares.values()].map((share) => ({ ...share })),
        dissolutionConfirmations: [...dissolutionConfirmations.values()].map((confirmation) => ({
          ...confirmation,
        })),
        auditLogEntries: auditLogEntries.map((entry) => ({ ...entry })),
      };
    },
    restore(snapshot, mutations) {
      if (!mutations) {
        households.clear();
        for (const household of snapshot.households) households.set(household.id, { ...household });
        memberships.clear();
        for (const membership of snapshot.memberships)
          memberships.set(membership.id, { ...membership });
        recordShares.clear();
        for (const share of snapshot.recordShares) recordShares.set(share.id, { ...share });
        dissolutionConfirmations.clear();
        for (const confirmation of snapshot.dissolutionConfirmations) {
          dissolutionConfirmations.set(`${confirmation.householdId}:${confirmation.userId}`, {
            ...confirmation,
          });
        }
        auditLogEntries.splice(
          0,
          auditLogEntries.length,
          ...snapshot.auditLogEntries.map((entry) => ({ ...entry })),
        );
        return;
      }
      const mutationLog = mutations;

      function restoreMap<T extends { id: string }>(
        resource: InMemoryTransactionResource,
        map: Map<string, T>,
        rows: T[],
      ) {
        const ids = mutationLog.get(resource);
        if (!ids) return;
        for (const id of ids) {
          const row = rows.find((candidate) => candidate.id === id);
          if (row) map.set(id, { ...row });
          else map.delete(id);
        }
      }

      restoreMap("households", households, snapshot.households);
      restoreMap("memberships", memberships, snapshot.memberships);
      restoreMap("recordShares", recordShares, snapshot.recordShares);

      const confirmationIds = mutationLog.get("dissolutionConfirmations");
      if (confirmationIds) {
        for (const id of confirmationIds) {
          const confirmation = snapshot.dissolutionConfirmations.find(
            (candidate) => `${candidate.householdId}:${candidate.userId}` === id,
          );
          if (confirmation) dissolutionConfirmations.set(id, { ...confirmation });
          else dissolutionConfirmations.delete(id);
        }
      }

      const auditIds = mutationLog.get("auditLogEntries");
      if (auditIds) {
        for (const id of auditIds) {
          const index = auditLogEntries.findIndex((entry) => entry.id === id);
          const entry = snapshot.auditLogEntries.find((candidate) => candidate.id === id);
          if (entry && index >= 0) auditLogEntries[index] = { ...entry };
          else if (entry) auditLogEntries.push({ ...entry });
          else if (index >= 0) auditLogEntries.splice(index, 1);
        }
      }
    },
  };
}
