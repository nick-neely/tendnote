/** One scheduled sample, not one model attempt. No account or provider payloads. */
export type FirstValueOutcome = "clean" | "retried" | "failed" | "serious" | "unknown";

export const FIRST_VALUE_INTERVAL_MS = 10 * 60 * 1000;
const WINDOW_SLOTS = 6;
const SUMMARY_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_SAMPLE_AGE_MS = 5 * 60 * 1000;

type Observation = { slot: number; at: number; outcome: FirstValueOutcome };

/** Bounded, deployment-wide state that survives cron instances and restarts. */
export type FirstValueHealthState = {
  history: Observation[];
  lastSummaryAt: number | null;
};

/** Immutable counts belonging to the notice, including on delayed delivery. */
export type FirstValueAlertContext = {
  sampledAt: string;
  samples: number;
  failed: number;
  retried: number;
};

export type FirstValueHealthSample = { at: Date; outcome: FirstValueOutcome };

type HealthDecision = {
  state: FirstValueHealthState;
  availability: "open" | "clear" | "hold";
  openedAt?: Date;
  context?: FirstValueAlertContext;
  summary?: FirstValueAlertContext;
};

export function emptyFirstValueHealth(): FirstValueHealthState {
  return { history: [], lastSummaryAt: null };
}

/**
 * Serialize this transition with the episode writes. Old, duplicate, future or
 * stale samples cannot advance counters. Missing slots break consecutive streaks;
 * the rolling window is six scheduled slots, never six arbitrarily old reads.
 */
export function advanceFirstValueHealth(input: {
  state: FirstValueHealthState;
  sample: FirstValueHealthSample;
  now: Date;
  incidentOpen: boolean;
}): HealthDecision {
  const { state, sample } = input;
  const at = sample.at.getTime();
  const age = input.now.getTime() - at;
  const slot = Math.floor(at / FIRST_VALUE_INTERVAL_MS) * FIRST_VALUE_INTERVAL_MS;
  const last = state.history.at(-1);
  // First completion wins for counting. Fresh serious evidence in that same
  // slot may escalate it, so a racing clean/unknown read cannot hide a hard failure.
  const escalate =
    last?.slot === slot && sample.outcome === "serious" && last.outcome !== "serious";
  if (
    !Number.isFinite(age) ||
    age < 0 ||
    age > MAX_SAMPLE_AGE_MS ||
    (last && slot <= last.slot && !escalate)
  ) {
    return { state, availability: "hold" };
  }
  const history = [
    ...state.history.filter(
      (entry) => entry.slot !== slot && slot - entry.slot < WINDOW_SLOTS * FIRST_VALUE_INTERVAL_MS,
    ),
    { at, slot, outcome: sample.outcome },
  ];
  const previous = history.at(-2);
  const adjacent = previous?.slot === slot - FIRST_VALUE_INTERVAL_MS;
  const failed = history.filter((entry) => entry.outcome === "failed");
  const retried = history.filter((entry) => entry.outcome === "retried");
  const context: FirstValueAlertContext = {
    sampledAt: sample.at.toISOString(),
    samples: history.filter((entry) => entry.outcome !== "unknown").length,
    failed: failed.length,
    retried: retried.length,
  };
  const decision: HealthDecision = {
    state: { ...state, history },
    availability: "hold",
  };
  if (
    sample.outcome === "serious" ||
    (sample.outcome === "failed" &&
      ((adjacent && previous.outcome === "failed") || failed.length >= 3))
  ) {
    decision.availability = "open";
    decision.openedAt = new Date(sample.outcome === "serious" ? at : (failed[0]?.at ?? at));
    decision.context = context;
  } else if (sample.outcome === "clean" && adjacent && previous.outcome === "clean") {
    decision.availability = "clear";
  }

  if (
    !input.incidentOpen &&
    decision.availability !== "open" &&
    (sample.outcome === "failed" || sample.outcome === "retried") &&
    failed.length + retried.length >= 3 &&
    (state.lastSummaryAt === null || slot - state.lastSummaryAt >= SUMMARY_INTERVAL_MS)
  ) {
    decision.summary = context;
    decision.state.lastSummaryAt = slot;
  }
  return decision;
}
