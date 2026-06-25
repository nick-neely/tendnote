import { randomUUID } from "node:crypto";
import { createFollowupSchema, type Followup } from "@tendnote/domain";
import type { FollowupStore } from "./types";

export function createInMemoryFollowupStore(): FollowupStore {
  const followups = new Map<string, Followup>();

  return {
    async createFollowup(values) {
      const parsed = createFollowupSchema.parse(values);
      const now = new Date();
      const followup: Followup = {
        ...parsed,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };

      followups.set(followup.id, followup);

      return followup;
    },
    async listFollowupsForPerson(input) {
      return [...followups.values()].filter(
        (followup) =>
          followup.ownerUserId === input.ownerUserId && followup.personId === input.personId,
      );
    },
  };
}
