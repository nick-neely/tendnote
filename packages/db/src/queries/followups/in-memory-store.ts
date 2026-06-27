import { randomUUID } from "node:crypto";
import {
  createFollowupSchema,
  type Followup,
  followupSchema,
  isActiveFollowupStatus,
} from "@tendnote/domain";
import { createInMemorySourceRecordStore } from "../source-records/in-memory-store";
import type { FollowupStore, InMemoryFollowupLifecycleStore } from "./types";

/**
 * Minimal follow-up CRUD store over a single map. It carries only follow-up
 * methods — no person, source-record, or audit surface — so it can be spread into
 * the composed snapshot store without shadowing those (PRD #11). The lifecycle
 * store composes this with a source-record store for the richer surface.
 */
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
    async getFollowup(input) {
      const followup = followups.get(input.followupId);

      if (!followup || followup.ownerUserId !== input.ownerUserId) {
        return null;
      }

      return followup;
    },
    async updateFollowup(input) {
      const followup = followups.get(input.followupId);

      if (!followup || followup.ownerUserId !== input.ownerUserId) {
        throw new Error("Follow-up not found.");
      }

      // Re-validate the merged record so field constraints (reason length, status
      // enum, required due date) hold for direct store callers too.
      const updated = followupSchema.parse({
        ...followup,
        ...input.patch,
        updatedAt: new Date(),
      });

      followups.set(updated.id, updated);

      return updated;
    },
    async listFollowupsForPerson(input) {
      return [...followups.values()].filter(
        (followup) =>
          followup.ownerUserId === input.ownerUserId && followup.personId === input.personId,
      );
    },
    async listActiveFollowupsForOwner(input) {
      return [...followups.values()]
        .filter(
          (followup) =>
            followup.ownerUserId === input.ownerUserId &&
            isActiveFollowupStatus(followup.status) &&
            (input.dueBefore === undefined ||
              followup.dueAt.getTime() <= input.dueBefore.getTime()),
        )
        .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    },
  };
}

/**
 * Follow-up lifecycle store for tests and composition: the follow-up CRUD store
 * plus a source-record base for person resolution, source-record grounding, and
 * audit logging. Mirrors how the memory review store is built (PRD #42).
 */
export function createInMemoryFollowupLifecycleStore(): InMemoryFollowupLifecycleStore {
  return {
    ...createInMemorySourceRecordStore(),
    ...createInMemoryFollowupStore(),
  };
}
