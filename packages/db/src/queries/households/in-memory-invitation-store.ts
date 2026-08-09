import { randomUUID } from "node:crypto";
import type { HouseholdMemberIdentity } from "@tendnote/domain";
import { createInMemoryHouseholdStore } from "./in-memory-store";
import type {
  HouseholdInvitation,
  HouseholdInvitationDelivery,
  HouseholdInvitationStore,
} from "./invitation-types";
import type { HouseholdIdentityStore } from "./overview";

/**
 * The invitation store the lifecycle suite runs against.
 *
 * `withTransaction` hands back the same store rather than isolating anything:
 * these tests exercise the lifecycle's decisions, and the atomicity they depend
 * on is a property of the Drizzle implementation's transaction plus row lock,
 * asserted separately against that adapter.
 */
export function createInMemoryHouseholdInvitationStore(options?: {
  households?: ReturnType<typeof createInMemoryHouseholdStore>;
  identities?: HouseholdMemberIdentity[];
}): HouseholdInvitationStore & {
  households: ReturnType<typeof createInMemoryHouseholdStore>;
  listDeliveries: () => HouseholdInvitationDelivery[];
} {
  const households = options?.households ?? createInMemoryHouseholdStore();
  const identityRows = options?.identities ?? [];
  const invitations = new Map<string, HouseholdInvitation>();
  const deliveries = new Map<string, HouseholdInvitationDelivery>();

  const identities: HouseholdIdentityStore = {
    async listUserIdentities(input) {
      const wanted = new Set(input.userIds);
      return identityRows.filter((identity) => wanted.has(identity.id));
    },
  };

  const store: HouseholdInvitationStore & {
    households: ReturnType<typeof createInMemoryHouseholdStore>;
    listDeliveries: () => HouseholdInvitationDelivery[];
  } = {
    households,
    identities,
    async withTransaction(fn) {
      return fn(store);
    },
    async lockHousehold(input) {
      return households.getHouseholdWorkspace(input);
    },
    async createInvitation(input) {
      const live = [...invitations.values()].find(
        (invitation) =>
          invitation.householdId === input.householdId &&
          invitation.normalizedEmail === input.normalizedEmail &&
          invitation.state === "pending",
      );
      if (live) {
        // Mirrors the partial unique index, so a lifecycle bug that skips the
        // live-invitation check fails here rather than in production.
        throw new Error("A live invitation to that address already exists.");
      }

      const now = new Date();
      const invitation: HouseholdInvitation = {
        ...input,
        id: randomUUID(),
        state: "pending",
        resendCount: 0,
        acceptedByUserId: null,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      invitations.set(invitation.id, invitation);
      return invitation;
    },
    async getInvitationById(input) {
      return invitations.get(input.invitationId) ?? null;
    },
    async getInvitationBySecretDigest(input) {
      return (
        [...invitations.values()].find(
          (invitation) => invitation.secretDigest === input.secretDigest,
        ) ?? null
      );
    },
    async listInvitations(input) {
      return [...invitations.values()].filter(
        (invitation) =>
          invitation.householdId === input.householdId &&
          (input.state === undefined || invitation.state === input.state),
      );
    },
    async updateInvitation(input) {
      const invitation = invitations.get(input.invitationId);
      if (!invitation) {
        throw new Error("Household invitation not found.");
      }
      const updated = { ...invitation, ...input.patch, updatedAt: new Date() };
      invitations.set(updated.id, updated);
      return updated;
    },
    async createDelivery(input) {
      const delivery: HouseholdInvitationDelivery = {
        id: randomUUID(),
        invitationId: input.invitationId,
        status: "queued",
        requestedAt: new Date(),
        claimedAt: null,
        completedAt: null,
        providerMessageId: null,
        failureClass: null,
      };
      deliveries.set(delivery.id, delivery);
      return delivery;
    },
    async claimDelivery(input) {
      const delivery = deliveries.get(input.deliveryId);
      if (delivery?.status !== "queued") return null;
      const claimed = { ...delivery, status: "sending" as const, claimedAt: new Date() };
      deliveries.set(claimed.id, claimed);
      return claimed;
    },
    async completeDelivery(input) {
      const delivery = deliveries.get(input.deliveryId);
      if (!delivery) {
        throw new Error("Household invitation delivery not found.");
      }
      const completed = {
        ...delivery,
        status: input.status,
        completedAt: new Date(),
        providerMessageId: input.providerMessageId ?? null,
        failureClass: input.failureClass ?? null,
      };
      deliveries.set(completed.id, completed);
      return completed;
    },
    listDeliveries: () => [...deliveries.values()],
  };

  return store;
}
