import {
  createHouseholdMembershipSchema,
  createHouseholdWorkspaceSchema,
  householdMembershipSchema,
} from "@tendnote/domain";
import { and, eq, inArray, or } from "drizzle-orm";
import { type DatabaseExecutor, getDb } from "../../client";
import {
  auditLog,
  householdDissolutionConfirmations,
  householdMemberships,
  householdRecordShares,
  householdWorkspaces,
} from "../../schema";
import type { HouseholdStore } from "./types";

/**
 * `resolveDb` is how this adapter is re-bound to an open transaction. The
 * invitation lifecycle has to count seats and create the membership that fills
 * one against the same transaction (ADR 0213), which is impossible while every
 * method reaches for the pooled connection itself.
 */
export function createDrizzleHouseholdStore(
  resolveDb: () => DatabaseExecutor = getDb,
): HouseholdStore {
  return {
    async createHouseholdWorkspace(input) {
      const [household] = await resolveDb()
        .insert(householdWorkspaces)
        .values(createHouseholdWorkspaceSchema.parse(input))
        .returning();
      if (!household) {
        throw new Error("Failed to create household workspace.");
      }
      return household;
    },
    async getHouseholdWorkspace(input) {
      const [household] = await resolveDb()
        .select()
        .from(householdWorkspaces)
        .where(eq(householdWorkspaces.id, input.householdId))
        .limit(1);
      return household ?? null;
    },
    async getHouseholdWorkspaces(input) {
      if (input.householdIds.length === 0) return [];
      return resolveDb()
        .select()
        .from(householdWorkspaces)
        .where(inArray(householdWorkspaces.id, input.householdIds));
    },
    async updateHouseholdWorkspace(input) {
      const [household] = await resolveDb()
        .update(householdWorkspaces)
        .set({ ...input.patch, updatedAt: new Date() })
        .where(eq(householdWorkspaces.id, input.householdId))
        .returning();
      if (!household) {
        throw new Error("Household workspace not found.");
      }
      return household;
    },
    async createHouseholdMembership(input) {
      const [membership] = await resolveDb()
        .insert(householdMemberships)
        .values(createHouseholdMembershipSchema.parse(input))
        .returning();
      if (!membership) {
        throw new Error("Failed to create household membership.");
      }
      return membership;
    },
    async getHouseholdMembership(input) {
      const [membership] = await resolveDb()
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
      const [membership] = await resolveDb()
        .select()
        .from(householdMemberships)
        .where(eq(householdMemberships.id, input.membershipId))
        .limit(1);
      return membership ?? null;
    },
    async updateHouseholdMembership(input) {
      const patch = householdMembershipSchema.partial().parse(input.patch);
      const [membership] = await resolveDb()
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
      return resolveDb()
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
      return resolveDb()
        .select()
        .from(householdMemberships)
        .where(
          and(
            eq(householdMemberships.userId, input.userId),
            eq(householdMemberships.status, "active"),
          ),
        );
    },
    async createHouseholdRecordShare(input) {
      const [share] = await resolveDb()
        .insert(householdRecordShares)
        .values(input)
        .onConflictDoNothing()
        .returning();

      if (share) {
        return share;
      }

      const [existing] = await resolveDb()
        .select()
        .from(householdRecordShares)
        .where(
          and(
            eq(householdRecordShares.recordKind, input.recordKind),
            eq(householdRecordShares.recordId, input.recordId),
            eq(householdRecordShares.sharedWithUserId, input.sharedWithUserId),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new Error("Failed to create household record share.");
      }
      return existing;
    },
    async listHouseholdRecordShares(input) {
      return resolveDb()
        .select()
        .from(householdRecordShares)
        .where(
          and(
            eq(householdRecordShares.householdId, input.householdId),
            eq(householdRecordShares.recordKind, input.recordKind),
            eq(householdRecordShares.recordId, input.recordId),
          ),
        );
    },
    async listHouseholdRecordSharesForRecords(input) {
      if (input.householdIds.length === 0 || input.recordIds.length === 0) return [];
      return resolveDb()
        .select()
        .from(householdRecordShares)
        .where(
          and(
            inArray(householdRecordShares.householdId, input.householdIds),
            eq(householdRecordShares.recordKind, input.recordKind),
            inArray(householdRecordShares.recordId, input.recordIds),
          ),
        );
    },
    async deleteHouseholdRecordShares(input) {
      await resolveDb()
        .delete(householdRecordShares)
        .where(
          and(
            eq(householdRecordShares.householdId, input.householdId),
            eq(householdRecordShares.recordKind, input.recordKind),
            eq(householdRecordShares.recordId, input.recordId),
          ),
        );
    },
    async deleteHouseholdRecordSharesForMember(input) {
      await resolveDb()
        .delete(householdRecordShares)
        .where(
          and(
            eq(householdRecordShares.householdId, input.householdId),
            ...(input.userId
              ? [
                  or(
                    eq(householdRecordShares.sharedWithUserId, input.userId),
                    eq(householdRecordShares.sharedByUserId, input.userId),
                  ),
                ]
              : []),
          ),
        );
    },
    async listHouseholdDissolutionConfirmations(input) {
      return resolveDb()
        .select({
          householdId: householdDissolutionConfirmations.householdId,
          userId: householdDissolutionConfirmations.userId,
          confirmedAt: householdDissolutionConfirmations.confirmedAt,
        })
        .from(householdDissolutionConfirmations)
        .where(eq(householdDissolutionConfirmations.householdId, input.householdId));
    },
    async confirmHouseholdDissolution(input) {
      const [confirmation] = await resolveDb()
        .insert(householdDissolutionConfirmations)
        .values({ householdId: input.householdId, userId: input.userId })
        .onConflictDoUpdate({
          target: [
            householdDissolutionConfirmations.householdId,
            householdDissolutionConfirmations.userId,
          ],
          // Re-confirming refreshes the moment rather than adding a second vote;
          // unanimity counts distinct owners, never presses.
          set: { confirmedAt: new Date() },
        })
        .returning({
          householdId: householdDissolutionConfirmations.householdId,
          userId: householdDissolutionConfirmations.userId,
          confirmedAt: householdDissolutionConfirmations.confirmedAt,
        });
      if (!confirmation) {
        throw new Error("Failed to record household dissolution confirmation.");
      }
      return confirmation;
    },
    async clearHouseholdDissolutionConfirmations(input) {
      await resolveDb()
        .delete(householdDissolutionConfirmations)
        .where(
          and(
            eq(householdDissolutionConfirmations.householdId, input.householdId),
            ...(input.userId ? [eq(householdDissolutionConfirmations.userId, input.userId)] : []),
          ),
        );
    },
    async createAuditLogEntry(input) {
      const [entry] = await resolveDb().insert(auditLog).values(input).returning();
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
