import { eq } from "drizzle-orm";
import { getDb } from "../../client";
import { accessProfiles } from "../../schema";
import type { AccessProfileStore } from "./types";

export function createDrizzleAccessProfileStore(): AccessProfileStore {
  return {
    async getByUserId(userId) {
      const [profile] = await getDb()
        .select()
        .from(accessProfiles)
        .where(eq(accessProfiles.userId, userId))
        .limit(1);

      return profile ?? null;
    },

    async create(input) {
      const [profile] = await getDb().insert(accessProfiles).values(input).returning();

      if (!profile) {
        throw new Error("Failed to create access profile.");
      }

      return profile;
    },

    async insertIfAbsent(input) {
      // `onConflictDoNothing` covers every unique constraint: the `userId` primary
      // key and the partial unique bootstrap index. A conflict yields no row, which
      // we surface as `null` so the query layer can fall back.
      const [profile] = await getDb()
        .insert(accessProfiles)
        .values(input)
        .onConflictDoNothing()
        .returning();

      return profile ?? null;
    },

    async update({ userId, patch }) {
      const [profile] = await getDb()
        .update(accessProfiles)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(accessProfiles.userId, userId))
        .returning();

      return profile ?? null;
    },
  };
}
