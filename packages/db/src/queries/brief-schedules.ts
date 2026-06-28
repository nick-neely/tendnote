import { ensureDefaultBriefSchedules } from "./brief-schedules/defaults";
import type { RunDueBriefSchedulesInput } from "./brief-schedules/dispatcher";
import { createBriefScheduleDispatcher } from "./brief-schedules/dispatcher";
import { createDrizzleBriefScheduleStore } from "./brief-schedules/drizzle-store";
import { generateBrief } from "./briefs";

export {
  type EnsureDefaultBriefSchedulesInput,
  ensureDefaultBriefSchedules,
} from "./brief-schedules/defaults";
export {
  createBriefScheduleDispatcher,
  type RunDueBriefSchedulesInput,
  type RunDueBriefSchedulesResult,
  type ScheduledBriefGenerator,
} from "./brief-schedules/dispatcher";
export { createDrizzleBriefScheduleStore } from "./brief-schedules/drizzle-store";
export { createInMemoryBriefScheduleStore } from "./brief-schedules/in-memory-store";
export type * from "./brief-schedules/types";

const defaultBriefScheduleStore = createDrizzleBriefScheduleStore();

// The dispatcher generates by calling the shared brief generator directly — the
// same default the manual web action uses — and never starts an Eve chat session
// or proactive channel delivery for in-app brief persistence (ADR-0066).
const defaultBriefScheduleDispatcher = createBriefScheduleDispatcher(
  defaultBriefScheduleStore,
  (input) => generateBrief(input),
);

export type DispatchDueBriefsInput = RunDueBriefSchedulesInput & {
  // When provided, default-enabled daily and weekly schedules are ensured for this
  // private Phase 1 owner before claiming, so in-app generation is on by default.
  ensureOwnerUserId?: string;
  timezone?: string;
};

/**
 * Default brief schedule dispatch entry point the root Eve schedule calls
 * (PRD #65, issue #72). It optionally seeds the private owner's default schedules,
 * then claims and generates the due rows via the shared generator.
 */
export async function dispatchDueBriefs(input: DispatchDueBriefsInput = {}) {
  if (input.ensureOwnerUserId) {
    // Idempotent bootstrap: ensureDefaultBriefSchedules only creates missing
    // cadences (and respects a disabled row), so calling it each tick is a cheap
    // couple of reads that keeps default in-app generation on without a separate
    // setup step.
    await ensureDefaultBriefSchedules(defaultBriefScheduleStore, {
      ownerUserId: input.ensureOwnerUserId,
      timezone: input.timezone ?? "UTC",
      now: input.now,
    });
  }

  return defaultBriefScheduleDispatcher.runDueBriefSchedules(input);
}
