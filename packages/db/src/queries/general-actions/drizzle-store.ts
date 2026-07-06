import {
  createGeneralActionEventSchema,
  createGeneralActionSchema,
  generalActionEventSchema,
  generalActionSchema,
  generalActionUpdateSchema,
} from "@tendnote/domain";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../client";
import { generalActionEvents, generalActions } from "../../schema";
import { createDrizzleGeneralActionAreaStore } from "../general-action-areas/drizzle-store";
import { createDrizzleSourceRecordStore } from "../source-records/drizzle-store";
import type { GeneralActionLifecycleStore, GeneralActionStore } from "./types";

/**
 * Drizzle-backed General Action CRUD + history store. Owner scoping is enforced in
 * every predicate so a caller can only read or mutate their own actions (AGENTS.md
 * owner-scoped seams).
 */
export function createDrizzleGeneralActionStore(): GeneralActionStore {
  return {
    async createGeneralAction(values) {
      const [action] = await getDb()
        .insert(generalActions)
        .values(createGeneralActionSchema.parse(values))
        .returning();

      if (!action) {
        throw new Error("Failed to create action.");
      }

      return generalActionSchema.parse(action);
    },
    async getGeneralAction(input) {
      const [action] = await getDb()
        .select()
        .from(generalActions)
        .where(
          and(
            eq(generalActions.id, input.generalActionId),
            eq(generalActions.ownerUserId, input.ownerUserId),
          ),
        )
        .limit(1);

      return action ? generalActionSchema.parse(action) : null;
    },
    async updateGeneralAction(input) {
      // Validate the patched fields so constraints hold for direct store callers.
      // A defaults-free schema is essential here: a partial of the base schema
      // would inject default values for absent keys and wipe those columns on
      // update (dueAt, notes, links, scope, …).
      const patch = generalActionUpdateSchema.parse(input.patch);
      const [action] = await getDb()
        .update(generalActions)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(generalActions.id, input.generalActionId),
            eq(generalActions.ownerUserId, input.ownerUserId),
          ),
        )
        .returning();

      if (!action) {
        throw new Error("Action not found.");
      }

      return generalActionSchema.parse(action);
    },
    async listGeneralActionsForOwner(input) {
      const query = getDb()
        .select()
        .from(generalActions)
        .where(
          and(
            eq(generalActions.ownerUserId, input.ownerUserId),
            ...(input.statuses && input.statuses.length > 0
              ? [inArray(generalActions.status, input.statuses)]
              : []),
          ),
        )
        // Order by surfacing time — a deferred action's resurface date, else its
        // due date — so the soonest-relevant action leads and unscheduled ones
        // (both null) fall to the end. This is the shared ordering contract the
        // in-memory store's `surfacingTime` mirrors; keep the two in step.
        .orderBy(
          sql`coalesce(${generalActions.deferUntil}, ${generalActions.dueAt}) asc nulls last`,
          desc(generalActions.createdAt),
        );

      const rows = await (input.limit === undefined ? query : query.limit(input.limit));
      return rows.map((row) => generalActionSchema.parse(row));
    },
    async createGeneralActionEvent(values) {
      const [event] = await getDb()
        .insert(generalActionEvents)
        .values(createGeneralActionEventSchema.parse(values))
        .returning();

      if (!event) {
        throw new Error("Failed to record action history.");
      }

      return generalActionEventSchema.parse(event);
    },
    async listGeneralActionEvents(input) {
      const rows = await getDb()
        .select()
        .from(generalActionEvents)
        .where(
          and(
            eq(generalActionEvents.ownerUserId, input.ownerUserId),
            eq(generalActionEvents.generalActionId, input.generalActionId),
          ),
        )
        .orderBy(asc(generalActionEvents.createdAt));

      return rows.map((row) => generalActionEventSchema.parse(row));
    },
  };
}

/**
 * General Action lifecycle store: the CRUD/history store plus the source-record
 * store for grounding verification. Mirrors the Follow-Up lifecycle-store
 * composition (ADR 0154).
 */
export function createDrizzleGeneralActionLifecycleStore(): GeneralActionLifecycleStore {
  return {
    ...createDrizzleSourceRecordStore(),
    ...createDrizzleGeneralActionAreaStore(),
    ...createDrizzleGeneralActionStore(),
  };
}
