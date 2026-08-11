import { householdEventPlanLinkSchema, householdEventPlanSchema } from "@tendnote/domain";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { type DatabaseExecutor, getDb } from "../../client";
import {
  followups,
  generalActions,
  householdEventPlanLinks,
  householdEventPlans,
  savedItems,
} from "../../schema";
import type {
  HouseholdEventPlanLinkTargetStore,
  HouseholdEventPlanStore,
} from "./event-plan-types";

export function createDrizzleHouseholdEventPlanStore(
  resolveDb: () => DatabaseExecutor = getDb,
): HouseholdEventPlanStore {
  return {
    async listPlans(input) {
      const rows = await resolveDb()
        .select()
        .from(householdEventPlans)
        .where(
          input.status
            ? and(
                eq(householdEventPlans.householdId, input.householdId),
                eq(householdEventPlans.status, input.status),
              )
            : eq(householdEventPlans.householdId, input.householdId),
        )
        .orderBy(asc(householdEventPlans.plannedFor), asc(householdEventPlans.createdAt));
      return rows.map((row) => householdEventPlanSchema.parse(row));
    },

    async getPlan(input) {
      const [row] = await resolveDb()
        .select()
        .from(householdEventPlans)
        .where(eq(householdEventPlans.id, input.planId))
        .limit(1);
      return row ? householdEventPlanSchema.parse(row) : null;
    },

    async createPlan(input) {
      const [row] = await resolveDb()
        .insert(householdEventPlans)
        .values({
          householdId: input.householdId,
          createdByUserId: input.actorUserId,
          lastActorUserId: input.actorUserId,
          title: input.title,
          details: input.details,
          plannedFor: input.plannedFor,
          calendarConnectionId: input.calendarConnectionId,
          calendarId: input.calendarId,
          calendarProviderEventId: input.calendarProviderEventId,
          createdAt: input.at,
          updatedAt: input.at,
        })
        .returning();
      if (!row) throw new Error("Failed to create household event plan.");
      return householdEventPlanSchema.parse(row);
    },

    async applyPlanWrite(input) {
      // The version is part of the WHERE clause, so the database decides the
      // race once. A read-compare-write above this would let two members both
      // observe the same current version and both write.
      const [row] = await resolveDb()
        .update(householdEventPlans)
        .set({
          ...input.patch,
          lastActorUserId: input.actorUserId,
          version: sql`${householdEventPlans.version} + 1`,
          updatedAt: input.at,
        })
        .where(
          and(
            eq(householdEventPlans.id, input.planId),
            eq(householdEventPlans.version, input.expectedVersion),
          ),
        )
        .returning();
      return row ? householdEventPlanSchema.parse(row) : null;
    },

    async listLinks(input) {
      if (input.planIds.length === 0) return [];
      const rows = await resolveDb()
        .select()
        .from(householdEventPlanLinks)
        .where(inArray(householdEventPlanLinks.planId, [...input.planIds]))
        .orderBy(asc(householdEventPlanLinks.createdAt));
      return rows.map((row) => householdEventPlanLinkSchema.parse(row));
    },

    async createLink(input) {
      const [row] = await resolveDb()
        .insert(householdEventPlanLinks)
        .values({
          planId: input.planId,
          linkKind: input.linkKind,
          recordId: input.recordId,
          linkedByUserId: input.linkedByUserId,
          createdAt: input.at,
        })
        // Linking the same record twice is one link. `set` touches the row so
        // `returning` yields it, rather than nothing on a conflict.
        .onConflictDoUpdate({
          target: [
            householdEventPlanLinks.planId,
            householdEventPlanLinks.linkKind,
            householdEventPlanLinks.recordId,
          ],
          set: { recordId: input.recordId },
        })
        .returning();
      if (!row) throw new Error("Failed to link household event plan record.");
      return householdEventPlanLinkSchema.parse(row);
    },

    async deleteLink(input) {
      const deleted = await resolveDb()
        .delete(householdEventPlanLinks)
        .where(
          and(
            eq(householdEventPlanLinks.id, input.linkId),
            eq(householdEventPlanLinks.planId, input.planId),
          ),
        )
        .returning({ id: householdEventPlanLinks.id });
      return deleted.length > 0;
    },
  };
}

/**
 * Reads a link target's own ownership and audience, and the one line that names
 * it.
 *
 * Only the columns the Household Authorization Proof needs plus the target's own
 * heading, never its body: this module must be able to decide whether a link may
 * be shown, and say what it is, without being able to show what is inside it.
 *
 * Each family keeps its own word for that heading, so the column is chosen with
 * the table rather than assumed - a Follow-Up has no title, and its `reason` is
 * the sentence a member wrote to name it.
 */
export function createDrizzleHouseholdEventPlanLinkTargetStore(
  resolveDb: () => DatabaseExecutor = getDb,
): HouseholdEventPlanLinkTargetStore {
  return {
    async readFacts(input) {
      const table =
        input.linkKind === "general_action"
          ? generalActions
          : input.linkKind === "followup"
            ? followups
            : savedItems;
      const title =
        input.linkKind === "general_action"
          ? generalActions.title
          : input.linkKind === "followup"
            ? followups.reason
            : savedItems.title;

      const [row] = await resolveDb()
        .select({
          ownerUserId: table.ownerUserId,
          scope: table.scope,
          householdId: table.householdId,
          title,
        })
        .from(table)
        .where(eq(table.id, input.recordId))
        .limit(1);

      return row ?? null;
    },
  };
}
