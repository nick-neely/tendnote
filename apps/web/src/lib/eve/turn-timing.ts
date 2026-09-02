/**
 * Durable durations for one assistant turn, read from the Eve stream.
 *
 * The activity disclosure says "Thought for 4 seconds" / "Worked for 9 seconds"
 * after a turn settles. A wall clock started when the component mounted cannot
 * say that honestly: it measures how long the *panel* watched, so a turn resumed
 * after a reload, a turn whose first token arrived before the disclosure
 * mounted, or a re-render mid-stream all report a number that never happened.
 *
 * `snapshot.events` is the authoritative record. Every event carries `meta.at`
 * (the ISO time eve stamped before writing it durably) and a `turnId`, so the
 * same stream replayed tomorrow yields the same durations it yields live. This
 * module is the one place that arithmetic lives, and it is plain data in and
 * plain numbers out - no React, no clock.
 *
 * Events are typed `readonly unknown[]` on purpose: the panel already treats the
 * raw stream that way (see `assistant-debug-trace.tsx`), and a projection that
 * narrows defensively keeps a protocol version bump from throwing inside a
 * render. Anything that does not match the expected shape is simply not counted.
 */

/** Durations for one turn. `null` means the stream did not say. */
export type TurnTiming = {
  /** `turn.started` → `turn.completed` / `turn.failed` / `turn.cancelled`. */
  readonly turnSeconds: number | null;
  /** Total time the model spent on reasoning blocks, summed across steps. */
  readonly reasoningSeconds: number | null;
  /** `actions.requested` → `action.result`, keyed by call id. */
  readonly toolSeconds: ReadonlyMap<string, number>;
};

const NO_TURN_TIMING: TurnTiming = {
  reasoningSeconds: null,
  toolSeconds: new Map(),
  turnSeconds: null,
};

/** One event narrowed to the fields this module reads. */
type TimedEvent = {
  readonly type: string;
  readonly at: number;
  readonly data: Record<string, unknown>;
};

const TURN_END_TYPES = new Set(["turn.cancelled", "turn.completed", "turn.failed"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The event's durable emission time as epoch milliseconds, or `null` when the
 * envelope is missing or unparseable. Events written before eve stamped `meta`
 * exist in the wild, so absence is expected rather than exceptional.
 */
function eventTime(event: Record<string, unknown>): number | null {
  const meta = event.meta;
  if (!isRecord(meta) || typeof meta.at !== "string") {
    return null;
  }
  const at = Date.parse(meta.at);
  return Number.isFinite(at) ? at : null;
}

/** Stream events for one turn, in order, reduced to `{type, at, data}`. */
function timedEvents(events: readonly unknown[], turnId: string | null | undefined): TimedEvent[] {
  const timed: TimedEvent[] = [];
  for (const event of events) {
    if (!isRecord(event) || typeof event.type !== "string" || !isRecord(event.data)) {
      continue;
    }
    const at = eventTime(event);
    if (at === null) {
      continue;
    }
    // A turn id narrows the stream to one turn. Without one - a message eve has
    // not yet stamped with `metadata.turnId` - every event counts, which is the
    // right answer for the single-turn case and a harmless over-count otherwise.
    if (turnId && event.data.turnId !== turnId) {
      continue;
    }
    timed.push({ at, data: event.data, type: event.type });
  }
  return timed;
}

/**
 * Whole seconds between two stamps, or `null` for a run that never closed or
 * closed before it opened (a clock skew across a resumed stream). Anything that
 * took measurable time reads as at least one second: "Thought for 0 seconds" is
 * a worse answer than a rounded-up one, and a genuinely instant span is far more
 * likely to be a stamp collision than a real measurement.
 */
function spanSeconds(startedAt: number, endedAt: number): number | null {
  const elapsed = endedAt - startedAt;
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return null;
  }
  return Math.max(1, Math.round(elapsed / 1000));
}

/** One open-then-closed run, reused for reasoning blocks and tool calls. */
type Run = { startedAt: number; endedAt: number | null };

/**
 * Opens a run, restarting it when the previous one already closed. A retried
 * step re-emits under the same `stepIndex`, and a retried tool call can reuse a
 * call id; the last run is the one that produced what the turn actually shows,
 * so it replaces the earlier one rather than extending it.
 */
function openRun(runs: Map<string, Run>, key: string, at: number): void {
  const open = runs.get(key);
  if (!open || open.endedAt !== null) {
    runs.set(key, { endedAt: null, startedAt: at });
  }
}

function closeRun(runs: Map<string, Run>, key: string, at: number): void {
  const open = runs.get(key);
  if (open && open.endedAt === null) {
    open.endedAt = at;
  }
}

/** Total whole seconds across every closed run, or `null` when none closed. */
function totalSeconds(runs: Map<string, Run>): number | null {
  let total = 0;
  let closed = 0;
  for (const run of runs.values()) {
    if (run.endedAt === null) {
      continue;
    }
    const seconds = spanSeconds(run.startedAt, run.endedAt);
    if (seconds !== null) {
      total += seconds;
      closed += 1;
    }
  }
  return closed > 0 ? total : null;
}

/** Every `callId` requested by one `actions.requested` event. */
function requestedCallIds(data: Record<string, unknown>): string[] {
  const actions = data.actions;
  if (!Array.isArray(actions)) {
    return [];
  }
  return actions
    .filter(isRecord)
    .map((action) => action.callId)
    .filter((callId): callId is string => typeof callId === "string");
}

/** The `callId` an `action.result` settles, which lives on the nested result. */
function resultCallId(data: Record<string, unknown>): string | null {
  const result = data.result;
  if (!isRecord(result) || typeof result.callId !== "string") {
    return null;
  }
  return result.callId;
}

/**
 * `turn.started` → whichever of the three endings arrived, or `null` for a turn
 * that is still running (or whose stream never said either).
 *
 * The three concerns below each walk the same short list of events once. One
 * fused loop was measurably harder to read than three named ones and said less:
 * a turn carries a handful of events, so the cost of the extra passes is noise
 * and what is bought is a function whose name is what it returns.
 */
function turnSpanSeconds(timed: readonly TimedEvent[]): number | null {
  let startedAt: number | null = null;
  let endedAt: number | null = null;

  for (const { at, type } of timed) {
    if (type === "turn.started") {
      startedAt ??= at;
      continue;
    }
    if (TURN_END_TYPES.has(type)) {
      endedAt = at;
    }
  }

  if (startedAt === null || endedAt === null) {
    return null;
  }
  return spanSeconds(startedAt, endedAt);
}

/**
 * Total whole seconds the model spent reasoning, summed across steps. Keyed by
 * `stepIndex` because a turn that stops to run tools reasons more than once.
 */
function reasoningTotalSeconds(timed: readonly TimedEvent[]): number | null {
  const runs = new Map<string, Run>();

  for (const { at, data, type } of timed) {
    if (type === "reasoning.appended") {
      openRun(runs, String(data.stepIndex ?? 0), at);
      continue;
    }
    if (type === "reasoning.completed") {
      closeRun(runs, String(data.stepIndex ?? 0), at);
    }
  }

  return totalSeconds(runs);
}

/** One open-then-closed run per tool call, keyed by `callId`. */
function toolRuns(timed: readonly TimedEvent[]): Map<string, Run> {
  const runs = new Map<string, Run>();

  for (const { at, data, type } of timed) {
    if (type === "actions.requested") {
      for (const callId of requestedCallIds(data)) {
        openRun(runs, callId, at);
      }
      continue;
    }
    if (type === "action.result") {
      const callId = resultCallId(data);
      if (callId) {
        closeRun(runs, callId, at);
      }
    }
  }

  return runs;
}

/** Each settled tool call's duration. A call that never returned has no entry. */
function toolCallSeconds(timed: readonly TimedEvent[]): ReadonlyMap<string, number> {
  const seconds = new Map<string, number>();

  for (const [callId, run] of toolRuns(timed)) {
    if (run.endedAt === null) {
      continue;
    }
    const elapsed = spanSeconds(run.startedAt, run.endedAt);
    if (elapsed !== null) {
      seconds.set(callId, elapsed);
    }
  }

  return seconds;
}

/**
 * Durations for the turn `turnId` identifies, derived from the durable stream.
 *
 * Pass the turn id from the assistant message's own `metadata.turnId`. When it
 * is absent the whole stream is measured, which is correct for a panel showing
 * one turn and over-counts across several - the caller decides whether that is
 * acceptable, and the view falls back to its own wall clock when the numbers
 * come back `null`.
 */
export function turnTiming(
  events: readonly unknown[],
  turnId: string | null | undefined,
): TurnTiming {
  const timed = timedEvents(events, turnId);
  if (timed.length === 0) {
    return NO_TURN_TIMING;
  }

  return {
    reasoningSeconds: reasoningTotalSeconds(timed),
    toolSeconds: toolCallSeconds(timed),
    turnSeconds: turnSpanSeconds(timed),
  };
}
