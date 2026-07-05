import type {
  ConfigureDiscordTargetInput,
  DiscordDeliveryTarget,
  DiscordInstall,
  DiscordInstallRef,
  DiscordInstallStore,
  RecordDiscordInstallInput,
} from "./types";

/**
 * Owner-scoped Discord install and proactive-delivery target management.
 *
 * Every write entry point is keyed on (owner, guild): an owner only ever
 * records, configures, enables, or removes their own install, so two Tendnote
 * users sharing one Discord guild cannot touch each other's install or delivery
 * target. Reads are owner-scoped too, except `listInstallsForGuild`, which is a
 * deliberate operator/admin lens across a guild.
 *
 * `deriveDeliveryTarget` is the fail-closed seam that connects installs to
 * proactive delivery: it returns a deliverable destination only for an enabled
 * install with a configured target, and `null` otherwise, so a disabled or
 * unconfigured install never yields a target.
 */
export function createDiscordInstallQueries(store: DiscordInstallStore) {
  return {
    /**
     * Record (create or refresh) an owner's install of the shared Discord app
     * into a guild. Idempotent per (owner, guild): re-recording refreshes the
     * Discord user id and scope/permission metadata but preserves any configured
     * target and the enabled flag, since installing is distinct from configuring
     * where deliveries land. Scope/permission metadata is only overwritten when
     * explicitly provided, so re-recording without it preserves stored values.
     */
    async recordDiscordInstall(input: RecordDiscordInstallInput): Promise<DiscordInstall> {
      return store.upsertByOwnerGuild({
        ownerUserId: input.ownerUserId,
        guildId: input.guildId,
        discordUserId: input.discordUserId,
        scopes: input.scopes,
        permissions: input.permissions,
      });
    },

    /**
     * Configure where an owner's proactive deliveries land in a guild. Only the
     * requesting owner's install is touched; a missing install (or one owned by a
     * different owner) is left untouched and resolves to `null`.
     */
    async configureDiscordTarget(
      input: ConfigureDiscordTargetInput,
    ): Promise<DiscordInstall | null> {
      return store.patchOwned(
        { ownerUserId: input.ownerUserId, guildId: input.guildId },
        { targetKind: input.targetKind, targetChannelId: input.targetChannelId },
      );
    },

    /**
     * Pause or resume proactive delivery for an owner's install without deleting
     * it (or the separate `discord_identities` link). Returns the updated install,
     * or `null` when the owner has no such install.
     */
    async setDiscordDeliveryEnabled(
      input: DiscordInstallRef & { enabled: boolean },
    ): Promise<DiscordInstall | null> {
      return store.patchOwned(
        { ownerUserId: input.ownerUserId, guildId: input.guildId },
        { enabled: input.enabled },
      );
    },

    async getDiscordInstall(ref: DiscordInstallRef): Promise<DiscordInstall | null> {
      return store.getByOwnerGuild(ref);
    },

    async listDiscordInstalls(input: { ownerUserId: string }): Promise<DiscordInstall[]> {
      return store.listByOwner(input.ownerUserId);
    },

    /** Operator/admin lens: every owner's install in a single guild. */
    async listInstallsForGuild(input: { guildId: string }): Promise<DiscordInstall[]> {
      return store.listByGuild(input.guildId);
    },

    /**
     * Derive the proactive-delivery destination for an owner. Scoped to one guild
     * when `guildId` is passed; otherwise the owner's single deliverable install
     * is used and an ambiguous set (more than one enabled, configured install)
     * fails closed to `null` rather than guessing. A disabled or unconfigured
     * install always derives to `null`.
     */
    async deriveDeliveryTarget(input: {
      ownerUserId: string;
      guildId?: string;
    }): Promise<DiscordDeliveryTarget | null> {
      if (input.guildId) {
        const install = await store.getByOwnerGuild({
          ownerUserId: input.ownerUserId,
          guildId: input.guildId,
        });
        return toDeliveryTarget(install);
      }

      const deliverable = (await store.listByOwner(input.ownerUserId))
        .map(toDeliveryTarget)
        .filter((target): target is DiscordDeliveryTarget => target !== null);

      // Only an unambiguous single destination derives; otherwise fail closed so
      // an owner with installs in multiple guilds must disambiguate by guild.
      return deliverable.length === 1 ? (deliverable[0] ?? null) : null;
    },

    /** Remove an owner's install in a guild. A row owned by a different owner is untouched. */
    async removeDiscordInstall(ref: DiscordInstallRef): Promise<boolean> {
      return store.deleteOwned(ref);
    },
  };
}

function toDeliveryTarget(install: DiscordInstall | null): DiscordDeliveryTarget | null {
  if (!install || !install.enabled || !install.targetKind || !install.targetChannelId) {
    return null;
  }

  return {
    guildId: install.guildId,
    targetKind: install.targetKind,
    targetId: install.targetChannelId,
  };
}

export type DiscordInstallQueries = ReturnType<typeof createDiscordInstallQueries>;
