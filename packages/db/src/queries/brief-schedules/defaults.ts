import { type BriefSchedule, computeNextBriefRun } from "@tendnote/domain";
import type { BriefScheduleStore } from "./types";

export type EnsureDefaultBriefSchedulesInput = {
  ownerUserId: string;
  timezone: string;
  // Local minute-of-day to run; defaults to 08:00.
  runAtMinute?: number;
  // Local weekday for the weekly review (0=Sun..6=Sat); defaults to Monday.
  weekday?: number;
  now?: Date;
};

const DEFAULT_RUN_AT_MINUTE = 8 * 60;
const DEFAULT_WEEKLY_WEEKDAY = 1;

/**
 * Ensures the private Phase 1 owner has default-enabled daily and weekly brief
 * schedules (PRD #65, issue #72). It is idempotent: existing rows are left as-is
 * (so a user who disabled a schedule is respected), and only missing cadences are
 * created. Rows can be disabled later via the store's enable/disable path.
 */
export async function ensureDefaultBriefSchedules(
  store: BriefScheduleStore,
  input: EnsureDefaultBriefSchedulesInput,
): Promise<BriefSchedule[]> {
  const now = input.now ?? new Date();
  const runAtMinute = input.runAtMinute ?? DEFAULT_RUN_AT_MINUTE;
  const weekday = input.weekday ?? DEFAULT_WEEKLY_WEEKDAY;

  const ensure = async (
    cadence: BriefSchedule["cadence"],
    recurrence: { weekday: number | null },
  ): Promise<BriefSchedule> => {
    const existing = await store.getBriefScheduleForOwner({
      ownerUserId: input.ownerUserId,
      cadence,
    });
    if (existing) {
      return existing;
    }

    return store.createBriefSchedule({
      ownerUserId: input.ownerUserId,
      cadence,
      timezone: input.timezone,
      runAtMinute,
      weekday: recurrence.weekday,
      nextRunAt: computeNextBriefRun(
        { cadence, timezone: input.timezone, runAtMinute, weekday: recurrence.weekday },
        now,
      ),
      enabled: true,
      // A Household Check-in is offered, never assumed: a member who has not
      // asked for one does not get shared records gathered on their behalf.
      householdCheckinEnabled: false,
      leaseExpiresAt: null,
      attempts: 0,
      lastError: null,
      lastRunAt: null,
    });
  };

  return Promise.all([ensure("daily", { weekday: null }), ensure("weekly", { weekday })]);
}
