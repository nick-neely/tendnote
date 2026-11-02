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
  // absent or expired (including a failed run's retry hold). Sets a fresh lease
  // and increments attempts, so overlapping runs never claim the same row.
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
  // Failure: record the error and clear the lease, or hold it until `retryAt`.
  // The hold spaces retries without changing the occurrence's local date or attempts.
  // When `nextRunAt` is provided the occurrence is given up and rolled forward
  // (attempts reset); otherwise it stays due for retry after any hold expires.
  releaseBriefSchedule: (input: {
    id: string;
    lastError: string;
    nextRunAt?: Date;
    retryAt?: Date;
  }) => Promise<BriefSchedule>;
};
