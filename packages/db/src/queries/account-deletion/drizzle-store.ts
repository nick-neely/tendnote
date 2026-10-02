import { asc, eq, sql } from "drizzle-orm";
import { type DatabaseExecutor, getDb } from "../../client";
import { accountDeletionIntents, user } from "../../schema";
import type { AccountDeletionIntent, AccountDeletionStore } from "./types";

const intentColumns = {
  userId: accountDeletionIntents.userId,
  requestedAt: accountDeletionIntents.requestedAt,
  journaledAt: accountDeletionIntents.journaledAt,
};

export function createDrizzleAccountDeletionStore(
  resolveDb: () => DatabaseExecutor = getDb,
): AccountDeletionStore {
  async function findIntent({ userId }: { userId: string }): Promise<AccountDeletionIntent | null> {
    const [intent] = await resolveDb()
      .select(intentColumns)
      .from(accountDeletionIntents)
      .where(eq(accountDeletionIntents.userId, userId))
      .limit(1);
    return intent ?? null;
  }

  return {
    async commitIntent({ userId, at }) {
      const [inserted] = await resolveDb()
        .insert(accountDeletionIntents)
        .values({ userId, requestedAt: at })
        .onConflictDoNothing()
        .returning(intentColumns);
      if (inserted) return inserted;

      const existing = await findIntent({ userId });
      if (!existing) throw new Error("Account deletion intent could not be committed.");
      return existing;
    },

    findIntent,

    async listIntents({ limit }) {
      return resolveDb()
        .select(intentColumns)
        .from(accountDeletionIntents)
        .orderBy(
          sql`${accountDeletionIntents.attemptedAt} asc nulls first`,
          asc(accountDeletionIntents.requestedAt),
          asc(accountDeletionIntents.userId),
        )
        .limit(limit);
    },

    async markAttempted({ userId, at }) {
      await resolveDb()
        .update(accountDeletionIntents)
        .set({ attemptedAt: at })
        .where(eq(accountDeletionIntents.userId, userId));
    },

    async markJournaled({ userId, at }) {
      await resolveDb()
        .update(accountDeletionIntents)
        .set({ journaledAt: at })
        .where(eq(accountDeletionIntents.userId, userId));
    },

    async deleteAccount({ userId }) {
      await resolveDb().delete(user).where(eq(user.id, userId));
    },
  };
}
