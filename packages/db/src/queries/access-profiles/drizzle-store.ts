import { and, asc, eq, isNull } from "drizzle-orm";
import { type DatabaseExecutor, getDb } from "../../client";
import { accessProfiles } from "../../schema";
import type { AccessProfileStore } from "./types";

export function createDrizzleAccessProfileStore(
  resolveDb: () => DatabaseExecutor = getDb,
): AccessProfileStore {
  return {
    async getByUserId(userId) {
      const [profile] = await resolveDb()
        .select()
        .from(accessProfiles)
        .where(eq(accessProfiles.userId, userId))
        .limit(1);

      return profile ?? null;
    },

    async listByStatus(status) {
      return resolveDb()
        .select()
        .from(accessProfiles)
        .where(eq(accessProfiles.status, status))
        .orderBy(asc(accessProfiles.createdAt), asc(accessProfiles.userId));
    },

    async create(input) {
      const [profile] = await resolveDb().insert(accessProfiles).values(input).returning();

      if (!profile) {
        throw new Error("Failed to create access profile.");
      }

      return profile;
    },

    async insertIfAbsent(input) {
      // `onConflictDoNothing` covers every unique constraint: the `userId` primary
      // key and the singleton bootstrap indexes. A conflict yields no row, which
      // we surface as `null` so the query layer can settle on the existing row.
      const [profile] = await resolveDb()
        .insert(accessProfiles)
        .values(input)
        .onConflictDoNothing()
        .returning();

      return profile ?? null;
    },

    async update({ userId, patch }) {
      const [profile] = await resolveDb()
        .update(accessProfiles)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(accessProfiles.userId, userId))
        .returning();

      return profile ?? null;
    },

    async claimSelfContextOnboardingReminder({ userId, reminderAt }) {
      const [profile] = await resolveDb()
        .update(accessProfiles)
        .set({ selfContextOnboardingReminderAt: reminderAt, updatedAt: new Date() })
        .where(
          and(
            eq(accessProfiles.userId, userId),
            eq(accessProfiles.selfContextOnboardingStatus, "dismissed"),
            isNull(accessProfiles.selfContextOnboardingReminderAt),
          ),
        )
        .returning();

      return profile ?? null;
    },
  };
}
