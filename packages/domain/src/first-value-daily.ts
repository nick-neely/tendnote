import {
  advanceFirstValueHealth,
  emptyFirstValueHealth,
  type FirstValueHealthDecision,
  type FirstValueHealthSample,
  type FirstValueHealthState,
  MAX_SAMPLE_AGE_MS,
} from "./first-value-health";

/**
 * How often the recovery cron runs the synthetic First Value check.
 * `ten_minute` walks it every pass and confirms model failures across slots
 * (ADR 0265). `daily` runs one complete check a day (ADR 0268).
 */
export type FirstValuePolicy = "ten_minute" | "daily";

/**
 * Prelaunch policy (#763, ADR 0268): one complete synthetic check a day while
 * no paying customer depends on the path. Restore `ten_minute` before paid
 * launch; the Hosted Obligations Register tracks it. Changing this constant is
 * the whole switch: the next pass migrates the persisted state.
 */
export const FIRST_VALUE_POLICY: FirstValuePolicy = "daily";

/**
 * From this UTC hour, the first pass claims the day's check: 9:00 or 10:00
 * Central, inside the operator's waking hours. The grounded answer uses it too.
 */
export const FIRST_VALUE_DAILY_HOUR_UTC = 15;

/**
 * Runs one UTC day may claim: the day's check, a confirmation of a transient
 * model failure, and one make-up for a run that produced no reading. Each run
 * keeps the model step's own three-call cap.
 */
export const FIRST_VALUE_DAILY_RUN_LIMIT = 3;

/**
 * A claimed run that never completed may be claimed again after this long.
 * Longer than the cron's 300-second limit, so a live run is never doubled.
 */
const RUN_LEASE_MS = 15 * 60 * 1000;

/** The daily policy's run ledger, persisted in the locked `first_value_health` row. */
export type FirstValueDailyState = {
  /** The UTC day the counters below belong to, `YYYY-MM-DD`. */
  day: string | null;
  /** Runs claimed on `day`, completed or not. */
  runs: number;
  /** Start time of the claimed run awaiting its completion, if any. */
  claimedAt: number | null;
  /** Whether `day` has a reading, so no further run is claimed. */
  settled: boolean;
  /** A transient model failure waiting for the next run to confirm or dismiss it. */
  unconfirmedFailureAt: number | null;
};

function emptyDaily(): FirstValueDailyState {
  return { day: null, runs: 0, claimedAt: null, settled: false, unconfirmedFailureAt: null };
}

/**
 * The state as `policy` reads it. A state written by the other policy is
 * migrated explicitly: its samples are discarded, never reinterpreted, and open
 * episodes are left alone, so a transition never recovers an incident. Returns
 * `state` itself when no migration is needed.
 */
export function firstValueStateFor(
  policy: FirstValuePolicy,
  state: FirstValueHealthState,
): FirstValueHealthState {
  if ((state.policy ?? "ten_minute") === policy) return state;
  const { lastSummaryAt } = state;
  if (policy === "daily") {
    return { ...emptyFirstValueHealth(), lastSummaryAt, policy, daily: emptyDaily() };
  }
  // A fresh ten-minute window: an open incident needs two clean slots again.
  return { ...emptyFirstValueHealth(), lastSummaryAt, policy };
}

/**
 * Whether this pass runs today's check. The first pass at or after the daily
 * hour claims it; later passes run only to confirm a transient failure or to
 * make up a run that gave no reading, within the day's run limit. A claimed
 * run blocks others for its lease, so concurrent passes never both pay for it.
 */
export function claimFirstValueDailyRun(
  current: FirstValueHealthState,
  now: Date,
): { state: FirstValueHealthState; claimed: boolean } {
  const state = firstValueStateFor("daily", current);
  if (now.getUTCHours() < FIRST_VALUE_DAILY_HOUR_UTC) return { state, claimed: false };
  const t = now.getTime();
  const day = now.toISOString().slice(0, 10);
  const daily = state.daily ?? emptyDaily();
  // A failure awaiting confirmation carries into the next day; the counters do not.
  const today =
    daily.day === day ? daily : { ...daily, day, runs: 0, claimedAt: null, settled: false };
  const leased = today.claimedAt !== null && t - today.claimedAt < RUN_LEASE_MS;
  if (today.settled || leased || today.runs >= FIRST_VALUE_DAILY_RUN_LIMIT) {
    return { state: today === daily ? state : { ...state, daily: today }, claimed: false };
  }
  return {
    state: { ...state, daily: { ...today, runs: today.runs + 1, claimedAt: t } },
    claimed: true,
  };
}

/**
 * Records one claimed run's reading. Only the completion of the run currently
 * claimed, within five minutes of its start, is accepted: a stale, duplicate,
 * or superseded completion holds. Unknown readings settle nothing, so a later
 * pass may make the run up. A serious failure opens at once; a transient model
 * failure opens when the next completed run fails too; recovery needs a clean
 * first-attempt run with no unconfirmed failure before it.
 */
export function advanceFirstValueDaily(input: {
  state: FirstValueHealthState;
  sample: FirstValueHealthSample;
  now: Date;
}): FirstValueHealthDecision {
  const state = firstValueStateFor("daily", input.state);
  const daily = state.daily ?? emptyDaily();
  const at = input.sample.at.getTime();
  const age = input.now.getTime() - at;
  if (daily.claimedAt !== at || !Number.isFinite(age) || age < 0 || age > MAX_SAMPLE_AGE_MS) {
    return { state, availability: "hold" };
  }
  const settle = (next: Partial<FirstValueDailyState>) => ({
    ...state,
    daily: { ...daily, claimedAt: null, settled: true, unconfirmedFailureAt: null, ...next },
  });
  const sampledAt = input.sample.at.toISOString();
  switch (input.sample.outcome) {
    case "unknown":
      return {
        state: settle({ settled: false, unconfirmedFailureAt: daily.unconfirmedFailureAt }),
        availability: "hold",
      };
    case "serious":
      return {
        state: settle({}),
        availability: "open",
        openedAt: input.sample.at,
        context: { sampledAt, samples: 1, failed: 0, retried: 0 },
      };
    case "failed":
      if (daily.unconfirmedFailureAt === null) {
        // Not settled: the next pass confirms it within the day's run limit.
        return {
          state: settle({ settled: false, unconfirmedFailureAt: at }),
          availability: "hold",
        };
      }
      return {
        state: settle({}),
        availability: "open",
        openedAt: new Date(daily.unconfirmedFailureAt),
        context: { sampledAt, samples: 2, failed: 2, retried: 0 },
      };
    case "retried":
      // Degraded, not clean: neither a confirmed failure nor a recovery.
      return { state: settle({}), availability: "hold" };
    case "clean":
      // A clean run dismisses an unconfirmed failure but cannot also recover.
      return {
        state: settle({}),
        availability: daily.unconfirmedFailureAt === null ? "clear" : "hold",
      };
  }
}

/** One completed sample under `policy`, from whichever state the row holds. */
export function advanceFirstValue(
  policy: FirstValuePolicy,
  input: Parameters<typeof advanceFirstValueHealth>[0],
): FirstValueHealthDecision {
  if (policy === "daily") return advanceFirstValueDaily(input);
  const state = firstValueStateFor("ten_minute", input.state);
  return advanceFirstValueHealth({ ...input, state });
}
