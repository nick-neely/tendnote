import { randomUUID } from "node:crypto";
import {
  createHouseholdMembershipSchema,
  createHouseholdWorkspaceSchema,
  type HouseholdMembership,
  type HouseholdWorkspace,
  householdMembershipSchema,
} from "@tendnote/domain";
import type { HouseholdAuditLogEntry, HouseholdStore } from "./types";

export function createInMemoryHouseholdStore(): HouseholdStore & {
  listAuditLogEntries: (input: { ownerUserId: string }) => Promise<HouseholdAuditLogEntry[]>;
} {
  const households = new Map<string, HouseholdWorkspace>();
  const memberships = new Map<string, HouseholdMembership>();
  const auditLogEntries: HouseholdAuditLogEntry[] = [];

  return {
    async createHouseholdWorkspace(input) {
      const parsed = createHouseholdWorkspaceSchema.parse(input);
      const existing = [...households.values()].find(
        (household) => household.ownerUserId === parsed.ownerUserId,
      );
      if (existing) {
        throw new Error("A household workspace already exists for this owner.");
      }

      const now = new Date();
      const household: HouseholdWorkspace = {
        ...parsed,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      households.set(household.id, household);
      return household;
    },
    async getHouseholdWorkspace(input) {
      return households.get(input.householdId) ?? null;
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
