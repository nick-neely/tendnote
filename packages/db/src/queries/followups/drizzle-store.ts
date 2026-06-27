import {
  ACTIVE_FOLLOWUP_STATUSES,
  createFollowupSchema,
  type FollowupStatus,
  followupSchema,
} from "@tendnote/domain";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { getDb } from "../../client";
import { followups } from "../../schema";
import { createDrizzleSourceRecordStore } from "../source-records/drizzle-store";
import type { FollowupLifecycleStore, FollowupStore } from "./types";

// Derived from the single domain source of truth so the SQL filter cannot drift
// from `isActiveFollowupStatus` (PRD #42).
const ACTIVE_STATUSES = [...ACTIVE_FOLLOWUP_STATUSES] as [FollowupStatus, ...FollowupStatus[]];

/**
 * Drizzle-backed follow-up CRUD store. Carries only follow-up methods so it can be
 * spread into the composed snapshot store without shadowing person/source/audit
 * methods (PRD #11).
 */
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
    async getFollowup(input) {
      const [followup] = await getDb()
        .select()
        .from(followups)
        .where(
          and(eq(followups.id, input.followupId), eq(followups.ownerUserId, input.ownerUserId)),
        )
        .limit(1);

      return followup ?? null;
    },
    async updateFollowup(input) {
      // Validate the patched fields so constraints hold for direct store callers,
      // matching the in-memory store.
      const patch = followupSchema.partial().parse(input.patch);
      const [followup] = await getDb()
        .update(followups)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(eq(followups.id, input.followupId), eq(followups.ownerUserId, input.ownerUserId)),
        )
        .returning();

      if (!followup) {
        throw new Error("Follow-up not found.");
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
    async listActiveFollowupsForOwner(input) {
      const query = getDb()
        .select()
        .from(followups)
        .where(
          and(
            eq(followups.ownerUserId, input.ownerUserId),
            inArray(followups.status, ACTIVE_STATUSES),
            ...(input.personId ? [eq(followups.personId, input.personId)] : []),
            ...(input.dueBefore ? [lte(followups.dueAt, input.dueBefore)] : []),
          ),
        )
        .orderBy(asc(followups.dueAt));

      return input.limit === undefined ? query : query.limit(input.limit);
    },
  };
}

/**
 * Follow-up lifecycle store: the follow-up CRUD store plus the source-record store
 * for person resolution, source-record grounding, and audit logging. Mirrors the
 * memory review store composition (PRD #42).
 */
export function createDrizzleFollowupLifecycleStore(): FollowupLifecycleStore {
  return {
    ...createDrizzleSourceRecordStore(),
    ...createDrizzleFollowupStore(),
  };
}
