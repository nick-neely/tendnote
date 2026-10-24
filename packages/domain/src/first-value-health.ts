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
  /** Older persisted rows have no boundary until their first confirmed recovery. */
  recoveredThroughSlot?: number | null;
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

type HealthInput = {
  state: FirstValueHealthState;
  sample: FirstValueHealthSample;
  now: Date;
  incidentOpen: boolean;
};

export function emptyFirstValueHealth(): FirstValueHealthState {
  return { history: [], lastSummaryAt: null, recoveredThroughSlot: null };
}

/**
 * Serialize this transition with the episode writes. Old, duplicate, future or
 * stale samples cannot advance counters. Missing slots break consecutive streaks;
 * the rolling window is six scheduled slots, never six arbitrarily old reads.
 */
export function advanceFirstValueHealth(input: HealthInput): HealthDecision {
  const { state, sample } = input;
  const at = sample.at.getTime();
  const slot = Math.floor(at / FIRST_VALUE_INTERVAL_MS) * FIRST_VALUE_INTERVAL_MS;
  if (!acceptsSample(input, slot)) return { state, availability: "hold" };
  const history = [
    ...state.history.filter(
      (entry) => entry.slot !== slot && slot - entry.slot < WINDOW_SLOTS * FIRST_VALUE_INTERVAL_MS,
    ),
    { at, slot, outcome: sample.outcome },
  ];
  const confirmation = history.filter(
    (entry) => entry.slot > (state.recoveredThroughSlot ?? -Infinity) || entry.slot === slot,
  );
  const context = sampleContext(confirmation, sample.at);
  const decision: HealthDecision = {
    state: { ...state, history },
    availability: availability(sample.outcome, confirmation.at(-2), slot, context.failed),
  };
  if (decision.availability === "open") {
    const firstFailure = confirmation.find((entry) => entry.outcome === "failed");
    decision.openedAt = new Date(sample.outcome === "serious" ? at : (firstFailure?.at ?? at));
    decision.context = context;
  }
  if (decision.availability === "clear" && input.incidentOpen) {
    decision.state.recoveredThroughSlot = slot;
  }
  const degradation = sampleContext(history, sample.at);
  if (summaryDue(input, decision.availability, degradation, slot)) {
    decision.summary = degradation;
    decision.state.lastSummaryAt = slot;
  }
  return decision;
}

function sampleContext(history: Observation[], at: Date): FirstValueAlertContext {
  return {
    sampledAt: at.toISOString(),
    samples: history.filter((entry) => entry.outcome !== "unknown").length,
    failed: history.filter((entry) => entry.outcome === "failed").length,
    retried: history.filter((entry) => entry.outcome === "retried").length,
  };
}

function acceptsSample(input: HealthInput, slot: number): boolean {
  const age = input.now.getTime() - input.sample.at.getTime();
  if (!Number.isFinite(age) || age < 0 || age > MAX_SAMPLE_AGE_MS) return false;
  const last = input.state.history.at(-1);
  if (!last || slot > last.slot) return true;
  // A racing serious result escalates the same slot without counting another check.
  return slot === last.slot && input.sample.outcome === "serious" && last.outcome !== "serious";
}

function availability(
  outcome: FirstValueOutcome,
  previous: Observation | undefined,
  slot: number,
  failed: number,
): HealthDecision["availability"] {
  if (outcome === "serious") return "open";
  const consecutive =
    previous?.slot === slot - FIRST_VALUE_INTERVAL_MS && previous.outcome === outcome;
  if (outcome === "clean" && consecutive) return "clear";
  if (outcome === "failed" && (consecutive || failed >= 3)) return "open";
  return "hold";
}

function summaryDue(
  input: HealthInput,
  action: HealthDecision["availability"],
  context: FirstValueAlertContext,
  slot: number,
): boolean {
  if (input.incidentOpen || action === "open") return false;
  if (input.sample.outcome !== "failed" && input.sample.outcome !== "retried") return false;
  if (context.failed + context.retried < 3) return false;
  return (
    input.state.lastSummaryAt === null || slot - input.state.lastSummaryAt >= SUMMARY_INTERVAL_MS
  );
}
