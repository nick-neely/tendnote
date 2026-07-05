import { and, eq } from "drizzle-orm";
import { getDb } from "../../client";
import { discordIdentities } from "../../schema";
import type { DiscordIdentityStore } from "./types";

export function createDrizzleDiscordIdentityStore(): DiscordIdentityStore {
  return {
    async getByDiscordUserId(discordUserId) {
      const [identity] = await getDb()
        .select()
        .from(discordIdentities)
        .where(eq(discordIdentities.discordUserId, discordUserId))
        .limit(1);

      return identity ?? null;
    },

    async listByOwner(ownerUserId) {
      return getDb()
        .select()
        .from(discordIdentities)
        .where(eq(discordIdentities.ownerUserId, ownerUserId))
        .orderBy(discordIdentities.discordUserId);
    },

    async upsertByDiscordUserId(values) {
      const [identity] = await getDb()
        .insert(discordIdentities)
        .values(values)
        .onConflictDoUpdate({
          target: discordIdentities.discordUserId,
          set: {
            ownerUserId: values.ownerUserId,
            displayIdentity: values.displayIdentity,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (!identity) {
        throw new Error("Failed to upsert Discord identity.");
      }

      return identity;
    },

    async deleteOwned({ ownerUserId, discordUserId }) {
      const deleted = await getDb()
        .delete(discordIdentities)
        .where(
          and(
            eq(discordIdentities.ownerUserId, ownerUserId),
            eq(discordIdentities.discordUserId, discordUserId),
          ),
        )
        .returning({ id: discordIdentities.id });

      return deleted.length > 0;
    },
  };
}
