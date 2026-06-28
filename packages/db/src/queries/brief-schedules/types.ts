import type { BriefCadence, BriefSchedule, CreateBriefScheduleInput } from "@tendnote/domain";

/**
 * Postgres-owned brief schedule lifecycle (PRD #65, issue #72, ADR-0066). Schedule
 * rows are inspectable records the static Eve dispatcher claims with a lease and
 * reschedules. Claiming is system-level (the dispatcher runs across owners and
 * derives owner scope from each claimed row); reads/writes for a single owner stay
 * owner-scoped.
 */
export type BriefScheduleStore = {
  createBriefSchedule: (input: CreateBriefScheduleInput) => Promise<BriefSchedule>;
  getBriefScheduleForOwner: (input: {
    ownerUserId: string;
    cadence: BriefCadence;
  }) => Promise<BriefSchedule | null>;
  listBriefSchedulesForOwner: (input: { ownerUserId: string }) => Promise<BriefSchedule[]>;
  // Enable/disable a schedule so default in-app generation can be turned off later.
  setBriefScheduleEnabled: (input: {
    ownerUserId: string;
    cadence: BriefCadence;
    enabled: boolean;
  }) => Promise<BriefSchedule>;
  // Atomically claims up to `limit` due rows: enabled, nextRunAt <= now, and lease
  // absent or expired. Sets a fresh lease and increments attempts, so overlapping
  // dispatcher runs never claim the same row (at-least-once without duplication).
  claimDueBriefSchedules: (input: {
    now: Date;
    leaseMs: number;
    limit?: number;
  }) => Promise<BriefSchedule[]>;
  // Success: advance to the next run, clear the lease, reset attempts/error, and
  // record the run time.
  completeBriefSchedule: (input: {
    id: string;
    nextRunAt: Date;
    ranAt: Date;
  }) => Promise<BriefSchedule>;
  // Failure: clear the lease and record the error. When `nextRunAt` is provided the
  // occurrence is given up and rolled forward (attempts reset); otherwise the row
  // stays due for retry on the next dispatcher tick.
  releaseBriefSchedule: (input: {
    id: string;
    lastError: string;
    nextRunAt?: Date;
  }) => Promise<BriefSchedule>;
};
