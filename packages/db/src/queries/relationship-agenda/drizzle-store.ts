import { eq } from "drizzle-orm";
import { getDb } from "../../client";
import { people } from "../../schema";
import { createDrizzleFollowupLifecycleStore } from "../followups/drizzle-store";
import type { RelationshipAgendaStore } from "./types";

export function createDrizzleRelationshipAgendaStore(): RelationshipAgendaStore {
  const followupStore = createDrizzleFollowupLifecycleStore();

  return {
    listActiveFollowupsForOwner: followupStore.listActiveFollowupsForOwner,
    getPerson: followupStore.getPerson,
    async listPeople(input) {
      return getDb()
        .select()
        .from(people)
        .where(eq(people.ownerUserId, input.ownerUserId))
        .orderBy(people.displayName);
    },
  };
}
