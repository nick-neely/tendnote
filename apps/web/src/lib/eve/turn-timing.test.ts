import { describe, expect, it } from "vitest";
import { turnTiming } from "./turn-timing";

/**
 * The durations the activity disclosure prints. They have to come from the
 * durable stream rather than a component's clock, because "Thought for 4
 * seconds" is a claim about what happened on the server, not about how long a
 * browser tab happened to be watching. These pin the arithmetic and, more
 * importantly, the refusals: a run that never closed, a stream from another
 * turn, and an event with no timestamp all report nothing rather than a number
 * nobody measured.
 */

let sequence = 0;

function event(type: string, at: string, data: Record<string, unknown> = {}) {
  sequence += 1;
  return {
    data: { sequence, turnId: "turn-1", ...data },
    meta: { at, id: `evt-${sequence}` },
    type,
  };
}

function toolCall(callId: string) {
  return { actions: [{ callId, input: {}, kind: "tool-call", toolName: "search_people" }] };
}

describe("turnTiming", () => {
  it("measures the turn from its own start and end events", () => {
    const timing = turnTiming(
      [
        event("turn.started", "2026-09-01T10:00:00.000Z"),
        event("step.started", "2026-09-01T10:00:00.500Z", { stepIndex: 0 }),
        event("turn.completed", "2026-09-01T10:00:09.000Z"),
      ],
      "turn-1",
    );

    expect(timing.turnSeconds).toBe(9);
  });

  it("ends the turn on a failure or a cancellation, not only on success", () => {
    const failed = turnTiming(
      [
        event("turn.started", "2026-09-01T10:00:00.000Z"),
        event("turn.failed", "2026-09-01T10:00:03.000Z", { code: "x", message: "boom" }),
      ],
      "turn-1",
    );
    const cancelled = turnTiming(
      [
        event("turn.started", "2026-09-01T10:00:00.000Z"),
        event("turn.cancelled", "2026-09-01T10:00:02.000Z"),
      ],
      "turn-1",
    );

    expect(failed.turnSeconds).toBe(3);
    expect(cancelled.turnSeconds).toBe(2);
  });

  it("says nothing about a turn that is still running", () => {
    const timing = turnTiming([event("turn.started", "2026-09-01T10:00:00.000Z")], "turn-1");

    expect(timing.turnSeconds).toBeNull();
    expect(timing.reasoningSeconds).toBeNull();
  });

  it("sums reasoning across the steps that produced it", () => {
    const timing = turnTiming(
      [
        event("reasoning.appended", "2026-09-01T10:00:00.000Z", { stepIndex: 0 }),
        event("reasoning.appended", "2026-09-01T10:00:01.000Z", { stepIndex: 0 }),
        event("reasoning.completed", "2026-09-01T10:00:04.000Z", { stepIndex: 0 }),
        event("reasoning.appended", "2026-09-01T10:00:06.000Z", { stepIndex: 1 }),
        event("reasoning.completed", "2026-09-01T10:00:08.000Z", { stepIndex: 1 }),
      ],
      "turn-1",
    );

    expect(timing.reasoningSeconds).toBe(6);
  });

  it("takes the last run when a step is retried under the same index", () => {
    const timing = turnTiming(
      [
        event("reasoning.appended", "2026-09-01T10:00:00.000Z", { stepIndex: 0 }),
        event("reasoning.completed", "2026-09-01T10:00:10.000Z", { stepIndex: 0 }),
        // The step ran again; only what the turn finally did is worth reporting.
        event("reasoning.appended", "2026-09-01T10:00:20.000Z", { stepIndex: 0 }),
        event("reasoning.completed", "2026-09-01T10:00:22.000Z", { stepIndex: 0 }),
      ],
      "turn-1",
    );

    expect(timing.reasoningSeconds).toBe(2);
  });

  it("times a tool call from its request to its result", () => {
    const timing = turnTiming(
      [
        event("actions.requested", "2026-09-01T10:00:00.000Z", {
          stepIndex: 0,
          ...toolCall("call-1"),
        }),
        event("action.result", "2026-09-01T10:00:03.000Z", {
          result: { callId: "call-1", kind: "tool-result" },
          status: "completed",
          stepIndex: 0,
        }),
      ],
      "turn-1",
    );

    expect(timing.toolSeconds.get("call-1")).toBe(3);
  });

  it("leaves a tool call with no result unmeasured", () => {
    const timing = turnTiming(
      [
        event("actions.requested", "2026-09-01T10:00:00.000Z", {
          stepIndex: 0,
          ...toolCall("call-1"),
        }),
      ],
      "turn-1",
    );

    expect(timing.toolSeconds.has("call-1")).toBe(false);
  });

  it("ignores events belonging to another turn", () => {
    const timing = turnTiming(
      [
        event("turn.started", "2026-09-01T10:00:00.000Z", { turnId: "turn-0" }),
        event("turn.completed", "2026-09-01T10:00:30.000Z", { turnId: "turn-0" }),
        event("turn.started", "2026-09-01T10:01:00.000Z"),
        event("turn.completed", "2026-09-01T10:01:02.000Z"),
      ],
      "turn-1",
    );

    expect(timing.turnSeconds).toBe(2);
  });

  it("survives a stream it cannot read", () => {
    const timing = turnTiming(
      [
        null,
        "not an event",
        { type: "turn.started" },
        { data: { turnId: "turn-1" }, type: "turn.started" },
        { data: { turnId: "turn-1" }, meta: { at: "nonsense" }, type: "turn.completed" },
      ],
      "turn-1",
    );

    expect(timing.turnSeconds).toBeNull();
    expect(timing.toolSeconds.size).toBe(0);
  });

  it("rounds a sub-second span up rather than reporting zero seconds", () => {
    const timing = turnTiming(
      [
        event("turn.started", "2026-09-01T10:00:00.000Z"),
        event("turn.completed", "2026-09-01T10:00:00.120Z"),
      ],
      "turn-1",
    );

    expect(timing.turnSeconds).toBe(1);
  });
});
