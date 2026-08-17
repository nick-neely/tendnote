import {
  type EnsureDefaultBriefSchedulesInput,
  ensureDefaultBriefSchedules,
} from "./brief-schedules/defaults";
import type { RunDueBriefSchedulesInput } from "./brief-schedules/dispatcher";
import { createBriefScheduleDispatcher } from "./brief-schedules/dispatcher";
import { createDrizzleBriefScheduleStore } from "./brief-schedules/drizzle-store";
import type { CalendarReaderForOwner } from "./calendar";
import { type DiscordProactiveDeliverySender, generateMorningAgenda } from "./morning-agenda";
import { generateWeeklyRelationshipReview } from "./weekly-relationship-review";

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

/** Bootstrap the default brief rows for one already-authorized owner. */
export function ensureDefaultBriefSchedulesForOwner(input: EnsureDefaultBriefSchedulesInput) {
  return ensureDefaultBriefSchedules(defaultBriefScheduleStore, input);
}

// The dispatcher generates by calling the shared brief generator directly — the
// same default the manual web action uses — and never starts an Eve chat session
// or proactive channel delivery for in-app brief persistence (ADR-0066).
const defaultBriefScheduleDispatcher = createBriefScheduleDispatcher(
  defaultBriefScheduleStore,
  (input) =>
    input.cadence === "daily"
      ? generateMorningAgenda(input).then((result) => result.brief)
      : generateWeeklyRelationshipReview(input).then((result) => result.brief),
);

export type DispatchDueBriefsInput = RunDueBriefSchedulesInput & {
  // When provided, default-enabled daily and weekly schedules are ensured for this
  // private Phase 1 owner before claiming, so in-app generation is on by default.
  ensureOwnerUserId?: string;
  timezone?: string;
  // Optional Phase 3 proactive delivery hook. When absent, Morning Agenda remains
  // in-app only; when present, the daily workflow persists the brief first and then
  // attempts Discord delivery through the configured workflow target.
  morningAgendaDiscordSender?: DiscordProactiveDeliverySender;
  weeklyRelationshipReviewDiscordSender?: DiscordProactiveDeliverySender;
  /** Runtime-owned Calendar reader composition for live cache misses. */
  calendarReaderFor?: CalendarReaderForOwner;
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

  if (
    !input.morningAgendaDiscordSender &&
    !input.weeklyRelationshipReviewDiscordSender &&
    !input.calendarReaderFor
  ) {
    return defaultBriefScheduleDispatcher.runDueBriefSchedules(input);
  }

  return createBriefScheduleDispatcher(defaultBriefScheduleStore, (generationInput) =>
    generationInput.cadence === "daily"
      ? generateMorningAgenda({
          ...generationInput,
          calendarReaderFor: input.calendarReaderFor,
          deliverDiscord: true,
          sender: input.morningAgendaDiscordSender,
        }).then((result) => result.brief)
      : generateWeeklyRelationshipReview({
          ...generationInput,
          calendarReaderFor: input.calendarReaderFor,
          ...(input.weeklyRelationshipReviewDiscordSender
            ? {
                deliverDiscord: true,
                sender: input.weeklyRelationshipReviewDiscordSender,
              }
            : {}),
        }).then((result) => result.brief),
  ).runDueBriefSchedules(input);
}
