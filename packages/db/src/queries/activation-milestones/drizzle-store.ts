import { eq } from "drizzle-orm";
import { type DatabaseExecutor, getDb } from "../../client";
import { activationMilestones } from "../../schema";
import type { ActivationMilestoneStore } from "./types";

export function createDrizzleActivationMilestoneStore(
  resolveDb: () => DatabaseExecutor = getDb,
): ActivationMilestoneStore {
  return {
    async insertIfAbsent({ userId, milestone }) {
      const inserted = await resolveDb()
        .insert(activationMilestones)
        .values({ userId, milestone })
        .onConflictDoNothing()
        .returning({ milestone: activationMilestones.milestone });

      return inserted.length > 0;
    },

    async listReached({ userId }) {
      const rows = await resolveDb()
        .select({ milestone: activationMilestones.milestone })
        .from(activationMilestones)
        .where(eq(activationMilestones.userId, userId));

      return rows.map((row) => row.milestone);
    },
  };
}
