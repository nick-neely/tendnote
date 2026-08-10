import { and, asc, eq } from "drizzle-orm";
import { type DatabaseExecutor, getDb } from "../../client";
import {
  householdInvitationDeliveries,
  householdInvitations,
  householdWorkspaces,
} from "../../schema";
import { createDrizzleHouseholdCalendarStore } from "./drizzle-calendar-store";
import { createDrizzleHouseholdStore } from "./drizzle-store";
import type { HouseholdInvitationStore } from "./invitation-types";
import { createDrizzleHouseholdIdentityStore } from "./overview";

export function createDrizzleHouseholdInvitationStore(
  resolveDb: () => DatabaseExecutor = getDb,
): HouseholdInvitationStore {
  return {
    households: createDrizzleHouseholdStore(resolveDb),
    identities: createDrizzleHouseholdIdentityStore(resolveDb),
    // Same `resolveDb`, so `withTransaction` re-binds this with everything else
    // and a departure's calendar cleanup lands in the departure's transaction.
    calendars: createDrizzleHouseholdCalendarStore(resolveDb),

    async withTransaction(fn) {
      return resolveDb().transaction(async (tx) =>
        fn(createDrizzleHouseholdInvitationStore(() => tx)),
      );
    },

    /**
     * `SELECT ... FOR UPDATE` on the household row is the serialization point for
     * every seat-consuming operation. Two concurrent accepts, or a send racing an
     * accept, queue here instead of both reading a household with a seat left and
     * both taking it (ADR 0213).
     */
    async lockHousehold(input) {
      const [household] = await resolveDb()
        .select()
        .from(householdWorkspaces)
        .where(eq(householdWorkspaces.id, input.householdId))
        .limit(1)
        .for("update");
      return household ?? null;
    },

    async createInvitation(input) {
      const [invitation] = await resolveDb().insert(householdInvitations).values(input).returning();
      if (!invitation) {
        throw new Error("Failed to create household invitation.");
      }
      return invitation;
    },

    async getInvitationById(input) {
      const [invitation] = await resolveDb()
        .select()
        .from(householdInvitations)
        .where(eq(householdInvitations.id, input.invitationId))
        .limit(1);
      return invitation ?? null;
    },

    async getInvitationBySecretDigest(input) {
      const [invitation] = await resolveDb()
        .select()
        .from(householdInvitations)
        .where(eq(householdInvitations.secretDigest, input.secretDigest))
        .limit(1);
      return invitation ?? null;
    },

    async listInvitations(input) {
      return resolveDb()
        .select()
        .from(householdInvitations)
        .where(
          and(
            eq(householdInvitations.householdId, input.householdId),
            ...(input.state ? [eq(householdInvitations.state, input.state)] : []),
          ),
        )
        .orderBy(asc(householdInvitations.createdAt));
    },

    async updateInvitation(input) {
      const [invitation] = await resolveDb()
        .update(householdInvitations)
        .set({ ...input.patch, updatedAt: new Date() })
        .where(eq(householdInvitations.id, input.invitationId))
        .returning();
      if (!invitation) {
        throw new Error("Household invitation not found.");
      }
      return invitation;
    },

    async createDelivery(input) {
      const [delivery] = await resolveDb()
        .insert(householdInvitationDeliveries)
        .values({ invitationId: input.invitationId })
        .returning();
      if (!delivery) {
        throw new Error("Failed to create household invitation delivery.");
      }
      return delivery;
    },

    /**
     * The claim is a conditional update, not a read-then-write: only a row still
     * `queued` moves to `sending`, so a retried request, a double submit, or a
     * second process finds nothing to claim and sends nothing.
     */
    async claimDelivery(input) {
      const [delivery] = await resolveDb()
        .update(householdInvitationDeliveries)
        .set({ status: "sending", claimedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(householdInvitationDeliveries.id, input.deliveryId),
            eq(householdInvitationDeliveries.status, "queued"),
          ),
        )
        .returning();
      return delivery ?? null;
    },

    async completeDelivery(input) {
      const [delivery] = await resolveDb()
        .update(householdInvitationDeliveries)
        .set({
          status: input.status,
          completedAt: new Date(),
          providerMessageId: input.providerMessageId ?? null,
          failureClass: input.failureClass ?? null,
          updatedAt: new Date(),
        })
        .where(eq(householdInvitationDeliveries.id, input.deliveryId))
        .returning();
      if (!delivery) {
        throw new Error("Household invitation delivery not found.");
      }
      return delivery;
    },
  };
}
