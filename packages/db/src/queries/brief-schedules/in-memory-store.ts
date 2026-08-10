import { randomUUID } from "node:crypto";
import {
  type BriefSchedule,
  briefScheduleSchema,
  createBriefScheduleSchema,
} from "@tendnote/domain";
import type { BriefScheduleStore } from "./types";

/**
 * Minimal brief schedule store over a single map. It enforces the same
 * claim semantics the drizzle store does — due, enabled, and free of a live lease —
 * so lease, retry, and duplicate-tick behavior is exercised without a database.
 */
export function createInMemoryBriefScheduleStore(): BriefScheduleStore {
  const schedules = new Map<string, BriefSchedule>();

  function requireById(id: string): BriefSchedule {
    const schedule = schedules.get(id);
    if (!schedule) {
      throw new Error("Brief schedule not found.");
    }
    return schedule;
  }

  function forOwnerCadence(ownerUserId: string, cadence: BriefSchedule["cadence"]) {
    return [...schedules.values()].find(
      (schedule) => schedule.ownerUserId === ownerUserId && schedule.cadence === cadence,
    );
  }

  return {
    async createBriefSchedule(input) {
      const parsed = createBriefScheduleSchema.parse(input);

      if (forOwnerCadence(parsed.ownerUserId, parsed.cadence)) {
        throw new Error("A brief schedule already exists for this owner and cadence.");
      }

      const now = new Date();
      const schedule = briefScheduleSchema.parse({
        ...parsed,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      });
      schedules.set(schedule.id, schedule);
      return schedule;
    },
    async getBriefScheduleForOwner(input) {
      return forOwnerCadence(input.ownerUserId, input.cadence) ?? null;
    },
    async listBriefSchedulesForOwner(input) {
      return [...schedules.values()].filter(
        (schedule) => schedule.ownerUserId === input.ownerUserId,
      );
    },
    async setBriefScheduleEnabled(input) {
      const schedule = forOwnerCadence(input.ownerUserId, input.cadence);
      if (!schedule) {
        throw new Error("Brief schedule not found.");
      }

      const updated = { ...schedule, enabled: input.enabled, updatedAt: new Date() };
      schedules.set(updated.id, updated);
      return updated;
    },
    async setHouseholdCheckinEnabled(input) {
      const owned = [...schedules.values()].filter(
        (schedule) => schedule.ownerUserId === input.ownerUserId,
      );
      return owned.map((schedule) => {
        const updated = {
          ...schedule,
          householdCheckinEnabled: input.enabled,
          updatedAt: new Date(),
        };
        schedules.set(updated.id, updated);
        return updated;
      });
    },
    async claimDueBriefSchedules(input) {
      const due = [...schedules.values()]
        .filter(
          (schedule) =>
            schedule.enabled &&
            schedule.nextRunAt.getTime() <= input.now.getTime() &&
            (schedule.leaseExpiresAt === null ||
              schedule.leaseExpiresAt.getTime() <= input.now.getTime()),
        )
        .sort((a, b) => a.nextRunAt.getTime() - b.nextRunAt.getTime());

      const claimable = input.limit === undefined ? due : due.slice(0, input.limit);

      return claimable.map((schedule) => {
        const claimed: BriefSchedule = {
          ...schedule,
          leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
          attempts: schedule.attempts + 1,
          updatedAt: new Date(),
        };
        schedules.set(claimed.id, claimed);
        return claimed;
      });
    },
    async completeBriefSchedule(input) {
      const schedule = requireById(input.id);
      const updated: BriefSchedule = {
        ...schedule,
        nextRunAt: input.nextRunAt,
        leaseExpiresAt: null,
        attempts: 0,
        lastError: null,
        lastRunAt: input.ranAt,
        updatedAt: new Date(),
      };
      schedules.set(updated.id, updated);
      return updated;
    },
    async releaseBriefSchedule(input) {
      const schedule = requireById(input.id);
      const givingUp = input.nextRunAt !== undefined;
      const updated: BriefSchedule = {
        ...schedule,
        leaseExpiresAt: null,
        lastError: input.lastError,
        ...(givingUp ? { nextRunAt: input.nextRunAt as Date, attempts: 0 } : {}),
        updatedAt: new Date(),
      };
      schedules.set(updated.id, updated);
      return updated;
    },
  };
}
