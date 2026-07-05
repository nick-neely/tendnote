import { and, eq } from "drizzle-orm";
import { getDb } from "../../client";
import { discordInstalls } from "../../schema";
import type { DiscordInstallStore } from "./types";

export function createDrizzleDiscordInstallStore(): DiscordInstallStore {
  return {
    async getByOwnerGuild({ ownerUserId, guildId }) {
      const [install] = await getDb()
        .select()
        .from(discordInstalls)
        .where(
          and(eq(discordInstalls.ownerUserId, ownerUserId), eq(discordInstalls.guildId, guildId)),
        )
        .limit(1);

      return install ?? null;
    },

    async listByOwner(ownerUserId) {
      return getDb()
        .select()
        .from(discordInstalls)
        .where(eq(discordInstalls.ownerUserId, ownerUserId))
        .orderBy(discordInstalls.guildId);
    },

    async listByGuild(guildId) {
      return getDb()
        .select()
        .from(discordInstalls)
        .where(eq(discordInstalls.guildId, guildId))
        .orderBy(discordInstalls.ownerUserId);
    },

    async upsertByOwnerGuild(values) {
      const [install] = await getDb()
        .insert(discordInstalls)
        .values({
          ownerUserId: values.ownerUserId,
          guildId: values.guildId,
          discordUserId: values.discordUserId,
          scopes: values.scopes ?? null,
          permissions: values.permissions ?? null,
        })
        .onConflictDoUpdate({
          target: [discordInstalls.ownerUserId, discordInstalls.guildId],
          // Refresh install metadata only; a configured target and enabled state
          // are preserved because installing is distinct from configuring delivery.
          // Scope/permission metadata is only overwritten when explicitly provided,
          // so a re-record that omits them keeps the stored values.
          set: {
            discordUserId: values.discordUserId,
            ...(values.scopes !== undefined ? { scopes: values.scopes } : {}),
            ...(values.permissions !== undefined ? { permissions: values.permissions } : {}),
            updatedAt: new Date(),
          },
        })
        .returning();

      if (!install) {
        throw new Error("Failed to upsert Discord install.");
      }

      return install;
    },

    async patchOwned({ ownerUserId, guildId }, patch) {
      const [install] = await getDb()
        .update(discordInstalls)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(eq(discordInstalls.ownerUserId, ownerUserId), eq(discordInstalls.guildId, guildId)),
        )
        .returning();

      return install ?? null;
    },

    async deleteOwned({ ownerUserId, guildId }) {
      const deleted = await getDb()
        .delete(discordInstalls)
        .where(
          and(eq(discordInstalls.ownerUserId, ownerUserId), eq(discordInstalls.guildId, guildId)),
        )
        .returning({ id: discordInstalls.id });

      return deleted.length > 0;
    },
  };
}
