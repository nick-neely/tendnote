import { randomUUID } from "node:crypto";
import type { HouseholdMemberIdentity } from "@tendnote/domain";
import { createInMemoryAccessProfileStore } from "../access-profiles/in-memory-store";
import { createInMemoryHouseholdCalendarStore } from "./in-memory-calendar-store";
import { createInMemoryHouseholdStore } from "./in-memory-store";
import {
  type InMemoryMutationLog,
  type InMemoryTransactionContext,
  inMemoryTransactionContext,
  recordInMemoryMutation,
} from "./in-memory-transaction";
import type {
  HouseholdInvitation,
  HouseholdInvitationDelivery,
  HouseholdInvitationStore,
} from "./invitation-types";
import type { HouseholdIdentityStore } from "./overview";
import {
  createNoopHouseholdScheduledWorkStore,
  type HouseholdScheduledWorkStore,
} from "./scheduled-work";

type InMemoryStoreSnapshot = {
  invitations: Array<[string, HouseholdInvitation]>;
  deliveries: Array<[string, HouseholdInvitationDelivery]>;
  households: ReturnType<ReturnType<typeof createInMemoryHouseholdStore>["snapshot"]>;
  accessProfiles: ReturnType<ReturnType<typeof createInMemoryAccessProfileStore>["snapshot"]>;
};

type LockHook = (input: { kind: "user" | "household"; id: string }) => Promise<void> | void;

export function createInMemoryHouseholdInvitationStore(options?: {
  households?: ReturnType<typeof createInMemoryHouseholdStore>;
  accessProfiles?: ReturnType<typeof createInMemoryAccessProfileStore>;
  calendars?: ReturnType<typeof createInMemoryHouseholdCalendarStore>;
  identities?: HouseholdMemberIdentity[];
  /** Injectable so a test can watch what a departure ends, not only what it moves. */
  scheduledWork?: HouseholdScheduledWorkStore;
  /** Test-only interleaving hook, called after the named lock is held. */
  lockHook?: LockHook;
}): HouseholdInvitationStore & {
  households: ReturnType<typeof createInMemoryHouseholdStore>;
  calendars: ReturnType<typeof createInMemoryHouseholdCalendarStore>;
  listDeliveries: () => HouseholdInvitationDelivery[];
} {
  const households = options?.households ?? createInMemoryHouseholdStore();
  const accessProfiles = options?.accessProfiles ?? createInMemoryAccessProfileStore();
  // Injectable so a governance test can seed a designated calendar and then
  // assert what a departure did to it, against the very store the lifecycle uses.
  const calendars = options?.calendars ?? createInMemoryHouseholdCalendarStore();
  const identityRows = options?.identities ?? [];
  const invitations = new Map<string, HouseholdInvitation>();
  const deliveries = new Map<string, HouseholdInvitationDelivery>();
  const locks = new Map<string, { held: boolean; waiters: Array<() => void> }>();

  function snapshot(): InMemoryStoreSnapshot {
    return {
      invitations: [...invitations.entries()].map(([id, invitation]) => [id, { ...invitation }]),
      deliveries: [...deliveries.entries()].map(([id, delivery]) => [id, { ...delivery }]),
      households: households.snapshot(),
      accessProfiles: accessProfiles.snapshot(),
    };
  }

  /** Roll back the touched entries only: restore each id, or drop it. */
  function restoreEntries<T>(
    ids: Iterable<string> | undefined,
    map: Map<string, T>,
    rows: readonly (readonly [string, T])[],
  ) {
    if (!ids) return;
    for (const id of ids) {
      const row = rows.find(([candidate]) => candidate === id)?.[1];
      if (row) map.set(id, { ...row });
      else map.delete(id);
    }
  }

  function restore(state: InMemoryStoreSnapshot, mutations: InMemoryMutationLog) {
    restoreEntries(mutations.get("invitations"), invitations, state.invitations);
    restoreEntries(mutations.get("deliveries"), deliveries, state.deliveries);
    households.restore(state.households, mutations);
    accessProfiles.restore(state.accessProfiles, mutations);
  }

  function release(key: string) {
    const lock = locks.get(key);
    if (!lock) return;
    const next = lock.waiters.shift();
    if (next) {
      next();
      return;
    }
    lock.held = false;
  }

  async function lock(key: string, input: { kind: "user" | "household"; id: string }) {
    const context = inMemoryTransactionContext.getStore();
    if (!context) throw new Error("In-memory row locks require a transaction.");
    const state = locks.get(key) ?? { held: false, waiters: [] };
    locks.set(key, state);
    if (state.held) {
      await new Promise<void>((resolve) => state.waiters.push(resolve));
    }
    state.held = true;
    context.releases.push(() => release(key));
    context.snapshot ??= snapshot();
    await options?.lockHook?.(input);
  }

  const identities: HouseholdIdentityStore = {
    async listUserIdentities(input) {
      const wanted = new Set(input.userIds);
      return identityRows.filter((identity) => wanted.has(identity.id));
    },
  };

  const scheduledWork = options?.scheduledWork ?? createNoopHouseholdScheduledWorkStore();

  const store: HouseholdInvitationStore & {
    households: ReturnType<typeof createInMemoryHouseholdStore>;
    calendars: ReturnType<typeof createInMemoryHouseholdCalendarStore>;
    listDeliveries: () => HouseholdInvitationDelivery[];
  } = {
    households,
    accessProfiles,
    identities,
    scheduledWork,
    calendars,
    async withTransaction(fn) {
      const context: InMemoryTransactionContext = { releases: [], mutations: new Map() };
      return inMemoryTransactionContext.run(context, async () => {
        try {
          return await fn(store);
        } catch (error) {
          if (context.snapshot)
            restore(context.snapshot as InMemoryStoreSnapshot, context.mutations);
          throw error;
        } finally {
          for (const releaseLock of context.releases.reverse()) releaseLock();
        }
      });
    },
    async lockUser(input) {
      await lock(`user:${input.userId}`, { kind: "user", id: input.userId });
      return true;
    },
    async lockHousehold(input) {
      await lock(`household:${input.householdId}`, { kind: "household", id: input.householdId });
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
      recordInMemoryMutation("invitations", invitation.id);
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
      recordInMemoryMutation("invitations", updated.id);
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
      recordInMemoryMutation("deliveries", delivery.id);
      deliveries.set(delivery.id, delivery);
      return delivery;
    },
    async claimDelivery(input) {
      const delivery = deliveries.get(input.deliveryId);
      if (delivery?.status !== "queued") return null;
      const claimed = { ...delivery, status: "sending" as const, claimedAt: new Date() };
      recordInMemoryMutation("deliveries", claimed.id);
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
      recordInMemoryMutation("deliveries", completed.id);
      deliveries.set(completed.id, completed);
      return completed;
    },
    listDeliveries: () => [...deliveries.values()],
  };

  return store;
}
