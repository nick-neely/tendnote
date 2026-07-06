import { randomUUID } from "node:crypto";
import type { DiscordIdentity, DiscordIdentityStore } from "./types";

export type InMemoryDiscordIdentityStoreSeed = {
  discordIdentities?: DiscordIdentity[];
};

export function createInMemoryDiscordIdentityStore(
  seed: InMemoryDiscordIdentityStoreSeed = {},
): DiscordIdentityStore {
  const identities = new Map(
    (seed.discordIdentities ?? []).map((identity) => [identity.discordUserId, identity]),
  );

  return {
    async getByDiscordUserId(discordUserId) {
      return identities.get(discordUserId) ?? null;
    },

    async listByOwner(ownerUserId) {
      return [...identities.values()]
        .filter((identity) => identity.ownerUserId === ownerUserId)
        .sort((a, b) => a.discordUserId.localeCompare(b.discordUserId));
    },

    async upsertByDiscordUserId(values) {
      const existing = identities.get(values.discordUserId);
      const now = new Date();
      const identity: DiscordIdentity = existing
        ? { ...existing, ...values, updatedAt: now }
        : { ...values, id: randomUUID(), createdAt: now, updatedAt: now };
      identities.set(values.discordUserId, identity);

      return identity;
    },

    async deleteOwned({ ownerUserId, discordUserId }) {
      const existing = identities.get(discordUserId);
      if (!existing || existing.ownerUserId !== ownerUserId) {
        return false;
      }

      return identities.delete(discordUserId);
    },
  };
}
