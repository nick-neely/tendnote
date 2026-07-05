import { randomUUID } from "node:crypto";
import type { DiscordInstall, DiscordInstallRef, DiscordInstallStore } from "./types";

export type InMemoryDiscordInstallStoreSeed = {
  discordInstalls?: DiscordInstall[];
};

function keyFor(ref: DiscordInstallRef): string {
  return `${ref.ownerUserId}::${ref.guildId}`;
}

export function createInMemoryDiscordInstallStore(
  seed: InMemoryDiscordInstallStoreSeed = {},
): DiscordInstallStore {
  const installs = new Map(
    (seed.discordInstalls ?? []).map((install) => [keyFor(install), install]),
  );

  return {
    async getByOwnerGuild(ref) {
      return installs.get(keyFor(ref)) ?? null;
    },

    async listByOwner(ownerUserId) {
      return [...installs.values()]
        .filter((install) => install.ownerUserId === ownerUserId)
        .sort((a, b) => a.guildId.localeCompare(b.guildId));
    },

    async listByGuild(guildId) {
      return [...installs.values()]
        .filter((install) => install.guildId === guildId)
        .sort((a, b) => a.ownerUserId.localeCompare(b.ownerUserId));
    },

    async upsertByOwnerGuild(values) {
      const key = keyFor(values);
      const existing = installs.get(key);
      const now = new Date();
      const install: DiscordInstall = existing
        ? {
            ...existing,
            discordUserId: values.discordUserId,
            // Only overwrite scope/permission metadata when explicitly provided;
            // an omitted field on a re-record preserves the stored value.
            ...(values.scopes !== undefined ? { scopes: values.scopes } : {}),
            ...(values.permissions !== undefined ? { permissions: values.permissions } : {}),
            updatedAt: now,
          }
        : {
            id: randomUUID(),
            ownerUserId: values.ownerUserId,
            guildId: values.guildId,
            discordUserId: values.discordUserId,
            targetKind: null,
            targetChannelId: null,
            enabled: true,
            scopes: values.scopes ?? null,
            permissions: values.permissions ?? null,
            createdAt: now,
            updatedAt: now,
          };
      installs.set(key, install);

      return install;
    },

    async patchOwned(ref, patch) {
      const key = keyFor(ref);
      const existing = installs.get(key);
      if (!existing) {
        return null;
      }

      const updated: DiscordInstall = {
        ...existing,
        ...(patch.targetKind !== undefined ? { targetKind: patch.targetKind } : {}),
        ...(patch.targetChannelId !== undefined ? { targetChannelId: patch.targetChannelId } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        updatedAt: new Date(),
      };
      installs.set(key, updated);

      return updated;
    },

    async deleteOwned(ref) {
      return installs.delete(keyFor(ref));
    },
  };
}
