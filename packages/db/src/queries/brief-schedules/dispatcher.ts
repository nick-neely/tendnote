import {
  type BriefCadence,
  type BriefGenerationReason,
  computeNextBriefRun,
  formatLocalDate,
} from "@tendnote/domain";
import type { BriefScheduleStore } from "./types";

/**
 * The shared brief-generation seam the dispatcher calls directly (PRD #65,
 * ADR-0066). It is the same owner-scoped generator the manual web action uses;
 * the dispatcher never starts an Eve chat session or proactive channel delivery
 * for in-app brief persistence.
 */
export type ScheduledBriefGenerator = (input: {
  ownerUserId: string;
  cadence: BriefCadence;
  localDate: string;
  generationReason: BriefGenerationReason;
  now: Date;
}) => Promise<unknown>;

export type RunDueBriefSchedulesInput = {
  now?: Date;
  // Lease duration while a row is being generated.
  leaseMs?: number;
  // Consecutive failures after which the occurrence is given up and rolled to the
  // next scheduled run rather than retried again.
  maxAttempts?: number;
  // Max rows to claim in one dispatcher tick.
  limit?: number;
};

export type RunDueBriefSchedulesResult = {
  claimed: number;
  generated: number;
  failed: number;
};

const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Claims due brief schedule rows and generates their briefs (PRD #65, issue #72).
 * Each claimed row is generated for its scheduled local date through the shared
 * generator, then advanced to its next run. Leases make claiming exclusive so
 * overlapping dispatcher ticks never double-generate, and the generator's
 * owner/local-date/cadence idempotency means even a retried generation returns the
 * existing brief instead of a duplicate. Failures clear the lease and either retry
 * on the next tick or, past maxAttempts, give up the occurrence and roll forward.
 */
export function createBriefScheduleDispatcher(
  store: BriefScheduleStore,
  generate: ScheduledBriefGenerator,
) {
  return {
    async runDueBriefSchedules(
      input: RunDueBriefSchedulesInput = {},
    ): Promise<RunDueBriefSchedulesResult> {
      const now = input.now ?? new Date();
      const leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS;
      const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

      const claimed = await store.claimDueBriefSchedules({ now, leaseMs, limit: input.limit });

      let generated = 0;
      let failed = 0;

      for (const schedule of claimed) {
        // The brief covers the local date of its scheduled run, not the (possibly
        // later) dispatch instant, so a late tick still produces the right day.
        const localDate = formatLocalDate(schedule.timezone, schedule.nextRunAt);

        try {
          await generate({
            ownerUserId: schedule.ownerUserId,
            cadence: schedule.cadence,
            localDate,
            generationReason: "scheduled",
            now,
          });

          await store.completeBriefSchedule({
            id: schedule.id,
            nextRunAt: computeNextBriefRun(schedule, now),
            ranAt: now,
          });
          generated += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // attempts was incremented by the claim; give up the occurrence once it
          // exceeds the budget so a persistently failing row cannot retry forever.
          const giveUp = schedule.attempts >= maxAttempts;

          await store.releaseBriefSchedule({
            id: schedule.id,
            lastError: message,
            ...(giveUp ? { nextRunAt: computeNextBriefRun(schedule, now) } : {}),
          });
          failed += 1;
        }
      }

      return { claimed: claimed.length, generated, failed };
    },
  };
}
