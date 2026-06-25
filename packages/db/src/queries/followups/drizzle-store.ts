import { createFollowupSchema } from "@tendnote/domain";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../client";
import { followups } from "../../schema";
import type { FollowupStore } from "./types";

export function createDrizzleFollowupStore(): FollowupStore {
  return {
    async createFollowup(values) {
      const [followup] = await getDb()
        .insert(followups)
        .values(createFollowupSchema.parse(values))
        .returning();

      if (!followup) {
        throw new Error("Failed to create follow-up.");
      }

      return followup;
    },
    async listFollowupsForPerson(input) {
      return getDb()
        .select()
        .from(followups)
        .where(
          and(eq(followups.ownerUserId, input.ownerUserId), eq(followups.personId, input.personId)),
        );
    },
  };
}
