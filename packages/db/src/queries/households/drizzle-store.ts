import {
  createHouseholdMembershipSchema,
  createHouseholdWorkspaceSchema,
  householdMembershipSchema,
} from "@tendnote/domain";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../client";
import { auditLog, householdMemberships, householdWorkspaces } from "../../schema";
import type { HouseholdStore } from "./types";

export function createDrizzleHouseholdStore(): HouseholdStore {
  return {
    async createHouseholdWorkspace(input) {
      const [household] = await getDb()
        .insert(householdWorkspaces)
        .values(createHouseholdWorkspaceSchema.parse(input))
        .returning();
      if (!household) {
        throw new Error("Failed to create household workspace.");
      }
      return household;
    },
    async getHouseholdWorkspace(input) {
      const [household] = await getDb()
        .select()
        .from(householdWorkspaces)
        .where(eq(householdWorkspaces.id, input.householdId))
        .limit(1);
      return household ?? null;
    },
    async createHouseholdMembership(input) {
      const [membership] = await getDb()
        .insert(householdMemberships)
        .values(createHouseholdMembershipSchema.parse(input))
        .returning();
      if (!membership) {
        throw new Error("Failed to create household membership.");
      }
      return membership;
    },
    async getHouseholdMembership(input) {
      const [membership] = await getDb()
        .select()
        .from(householdMemberships)
        .where(
          and(
            eq(householdMemberships.householdId, input.householdId),
            eq(householdMemberships.userId, input.userId),
          ),
        )
        .limit(1);
      return membership ?? null;
    },
    async getHouseholdMembershipById(input) {
      const [membership] = await getDb()
        .select()
        .from(householdMemberships)
        .where(eq(householdMemberships.id, input.membershipId))
        .limit(1);
      return membership ?? null;
    },
    async updateHouseholdMembership(input) {
      const patch = householdMembershipSchema.partial().parse(input.patch);
      const [membership] = await getDb()
        .update(householdMemberships)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(householdMemberships.id, input.membershipId))
        .returning();
      if (!membership) {
        throw new Error("Household membership not found.");
      }
      return membership;
    },
    async listHouseholdMemberships(input) {
      return getDb()
        .select()
        .from(householdMemberships)
        .where(
          and(
            eq(householdMemberships.householdId, input.householdId),
            ...(input.status ? [eq(householdMemberships.status, input.status)] : []),
          ),
        );
    },
    async listActiveHouseholdMembershipsForUser(input) {
      return getDb()
        .select()
        .from(householdMemberships)
        .where(
          and(
            eq(householdMemberships.userId, input.userId),
            eq(householdMemberships.status, "active"),
          ),
        );
    },
    async createAuditLogEntry(input) {
      const [entry] = await getDb().insert(auditLog).values(input).returning();
      if (!entry) {
        throw new Error("Failed to create audit log entry.");
      }
      if (!entry.ownerUserId) {
        throw new Error("Household audit log entry is missing owner user id.");
      }
      return { ...entry, ownerUserId: entry.ownerUserId };
    },
  };
}
