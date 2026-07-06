import type {
  DiscordIdentity,
  DiscordIdentityRef,
  DiscordIdentityStore,
  LinkDiscordIdentityInput,
} from "./types";

/**
 * Owner-scoped Discord identity resolution and mapping. `resolveOwnerUserId` is the
 * fail-closed entry point Discord interactions use before writing any Tendnote
 * context: an unmapped Discord user id resolves to `null`, never an owner.
 *
 * Inbound resolution (`resolveOwnerUserId`/`getDiscordIdentity`) is global by
 * discord user id — a Discord interaction only carries the discord user id. Write
 * entry points are owner-scoped: reassigning a mapped discord user to a different
 * owner is explicit, and unlink only removes a row the passed owner owns.
 */
export function createDiscordIdentityQueries(store: DiscordIdentityStore) {
  return {
    /** Resolve the Tendnote owner for a Discord user id, or `null` when unmapped. */
    async resolveOwnerUserId(input: { discordUserId: string }): Promise<string | null> {
      if (!input.discordUserId) {
        return null;
      }

      const identity = await store.getByDiscordUserId(input.discordUserId);
      return identity?.ownerUserId ?? null;
    },

    async getDiscordIdentity(input: { discordUserId: string }): Promise<DiscordIdentity | null> {
      if (!input.discordUserId) {
        return null;
      }

      return store.getByDiscordUserId(input.discordUserId);
    },

    async listDiscordIdentities(input: { ownerUserId: string }): Promise<DiscordIdentity[]> {
      return store.listByOwner(input.ownerUserId);
    },

    /**
     * Map a Discord user id to a Tendnote owner. A Discord user id already mapped
     * to a different owner is rejected unless `reassign: true` is passed, so
     * cross-owner reassignment is never a silent side effect.
     */
    async linkDiscordIdentity(input: LinkDiscordIdentityInput): Promise<DiscordIdentity> {
      const existing = await store.getByDiscordUserId(input.discordUserId);
      if (existing && existing.ownerUserId !== input.ownerUserId && !input.reassign) {
        throw new Error(
          `Discord user ${input.discordUserId} is already mapped to a different Tendnote owner; pass reassign to move it.`,
        );
      }

      return store.upsertByDiscordUserId({
        ownerUserId: input.ownerUserId,
        discordUserId: input.discordUserId,
        displayIdentity: input.displayIdentity ?? null,
      });
    },

    /**
     * Remove a Discord user id mapping the given owner owns. Returns whether a row
     * was removed; a mapping owned by a different owner is left untouched.
     */
    async unlinkDiscordIdentity(ref: DiscordIdentityRef): Promise<boolean> {
      return store.deleteOwned(ref);
    },
  };
}
