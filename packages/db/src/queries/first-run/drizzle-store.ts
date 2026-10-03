import type { ActivationMilestone } from "@tendnote/domain/activation-milestones";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../../client";
import { accessProfiles, activationMilestones, assistantConversations, people } from "../../schema";
import type { FirstRunStore } from "./types";

const FIRST_VALUE: ActivationMilestone = "first_value_reached";

export function createDrizzleFirstRunStore(): FirstRunStore {
  return {
    async readFacts({ userId }) {
      const [row] = await getDb()
        .select({
          firstRunClosed: sql<boolean>`${accessProfiles.firstRunClosedAt} is not null`,
          integrationOfferClosed: sql<boolean>`${accessProfiles.integrationOfferClosedAt} is not null`,
          hasConversation: sql<boolean>`exists (select 1 from ${assistantConversations} where ${assistantConversations.ownerUserId} = ${userId})`,
          hasPerson: sql<boolean>`exists (select 1 from ${people} where ${people.ownerUserId} = ${userId})`,
          firstValueReached: sql<boolean>`exists (select 1 from ${activationMilestones} where ${activationMilestones.userId} = ${userId} and ${activationMilestones.milestone} = ${FIRST_VALUE})`,
        })
        .from(accessProfiles)
        .where(eq(accessProfiles.userId, userId));

      return row ?? null;
    },

    async hasPerson({ userId }) {
      const rows = await getDb()
        .select({ id: people.id })
        .from(people)
        .where(eq(people.ownerUserId, userId))
        .limit(1);
      return rows.length > 0;
    },

    async closeFirstRun({ userId, at }) {
      await getDb()
        .update(accessProfiles)
        .set({ firstRunClosedAt: at, updatedAt: at })
        .where(and(eq(accessProfiles.userId, userId), isNull(accessProfiles.firstRunClosedAt)));
    },

    async closeIntegrationOffer({ userId, at }) {
      await getDb()
        .update(accessProfiles)
        .set({ integrationOfferClosedAt: at, updatedAt: at })
        .where(
          and(eq(accessProfiles.userId, userId), isNull(accessProfiles.integrationOfferClosedAt)),
        );
    },
  };
}
