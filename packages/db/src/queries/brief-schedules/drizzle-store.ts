import {
  type BriefSchedule,
  briefScheduleSchema,
  createBriefScheduleSchema,
} from "@tendnote/domain";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "../../client";
import { briefSchedules } from "../../schema";
import type { BriefScheduleStore } from "./types";

function toSchedule(row: typeof briefSchedules.$inferSelect): BriefSchedule {
  return briefScheduleSchema.parse(row);
}

/**
 * Drizzle-backed brief schedule store. Claiming uses `FOR UPDATE SKIP LOCKED` so
 * overlapping dispatcher ticks lock disjoint due rows — the same Postgres-owned
 * queue safety the extraction job store uses (ADR-0018).
 */
export function createDrizzleBriefScheduleStore(): BriefScheduleStore {
  return {
    async createBriefSchedule(input) {
      const [schedule] = await getDb()
        .insert(briefSchedules)
        .values(createBriefScheduleSchema.parse(input))
        .returning();

      if (!schedule) {
        throw new Error("Failed to create brief schedule.");
      }

      return toSchedule(schedule);
    },
    async getBriefScheduleForOwner(input) {
      const [schedule] = await getDb()
        .select()
        .from(briefSchedules)
        .where(
          and(
            eq(briefSchedules.ownerUserId, input.ownerUserId),
            eq(briefSchedules.cadence, input.cadence),
          ),
        )
        .limit(1);

      return schedule ? toSchedule(schedule) : null;
    },
    async listBriefSchedulesForOwner(input) {
      const rows = await getDb()
        .select()
        .from(briefSchedules)
        .where(eq(briefSchedules.ownerUserId, input.ownerUserId));

      return rows.map(toSchedule);
    },
    async setBriefScheduleEnabled(input) {
      const [schedule] = await getDb()
        .update(briefSchedules)
        .set({ enabled: input.enabled, updatedAt: new Date() })
        .where(
          and(
            eq(briefSchedules.ownerUserId, input.ownerUserId),
            eq(briefSchedules.cadence, input.cadence),
          ),
        )
        .returning();

      if (!schedule) {
        throw new Error("Brief schedule not found.");
      }

      return toSchedule(schedule);
    },
    async setHouseholdCheckinEnabled(input) {
      const rows = await getDb()
        .update(briefSchedules)
        .set({ householdCheckinEnabled: input.enabled, updatedAt: new Date() })
        .where(eq(briefSchedules.ownerUserId, input.ownerUserId))
        .returning();

      // No rows is not an error: a member who has never had a briefing generated
      // has nothing to flip, and their answer to "is the Check-in on?" stays the
      // correct `false`.
      return rows.map(toSchedule);
    },
    async claimDueBriefSchedules(input) {
      // Lock due, enabled, lease-free rows and skip ones another dispatcher holds.
      const dueRows = getDb()
        .select({ id: briefSchedules.id })
        .from(briefSchedules)
        .where(
          and(
            eq(briefSchedules.enabled, true),
            lte(briefSchedules.nextRunAt, input.now),
            or(
              isNull(briefSchedules.leaseExpiresAt),
              lte(briefSchedules.leaseExpiresAt, input.now),
            ),
          ),
        )
        .orderBy(asc(briefSchedules.nextRunAt))
        .limit(input.limit ?? 100)
        .for("update", { skipLocked: true });

      const rows = await getDb()
        .update(briefSchedules)
        .set({
          leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
          attempts: sql`${briefSchedules.attempts} + 1`,
          updatedAt: input.now,
        })
        .where(inArray(briefSchedules.id, dueRows))
        .returning();

      return rows.map(toSchedule).sort((a, b) => a.nextRunAt.getTime() - b.nextRunAt.getTime());
    },
    async completeBriefSchedule(input) {
      const [schedule] = await getDb()
        .update(briefSchedules)
        .set({
          nextRunAt: input.nextRunAt,
          leaseExpiresAt: null,
          attempts: 0,
          lastError: null,
          lastRunAt: input.ranAt,
          updatedAt: new Date(),
        })
        .where(eq(briefSchedules.id, input.id))
        .returning();

      if (!schedule) {
        throw new Error("Brief schedule not found.");
      }

      return toSchedule(schedule);
    },
    async releaseBriefSchedule(input) {
      const [schedule] = await getDb()
        .update(briefSchedules)
        .set({
          leaseExpiresAt: null,
          lastError: input.lastError,
          ...(input.nextRunAt ? { nextRunAt: input.nextRunAt, attempts: 0 } : {}),
          updatedAt: new Date(),
        })
        .where(eq(briefSchedules.id, input.id))
        .returning();

      if (!schedule) {
        throw new Error("Brief schedule not found.");
      }

      return toSchedule(schedule);
    },
  };
}
