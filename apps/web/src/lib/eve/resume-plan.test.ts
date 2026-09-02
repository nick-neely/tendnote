import type { MessageStreamEvent } from "eve/client";
import { describe, expect, it } from "vitest";
import { resumePlanFromEvents } from "./resume-plan";

/**
 * The one decision that separates a thread reopening in a third of a second from
 * one reopening in fifteen: whether anything is still happening in it.
 *
 * Eve follows a resumed stream until it sees a turn boundary. On a thread whose
 * last event *is* a boundary that wait can only end at the 15s idle timeout, and
 * the whole time the composer refuses messages. So a settled tail must be read as
 * settled, and an unsettled one must still resume - being wrong in that direction
 * would drop a live turn's remaining events on the floor.
 */

const waiting = {
  data: { continuationToken: "", wait: "next-user-message" },
  type: "session.waiting",
} as MessageStreamEvent;

const started = { data: {}, type: "session.started" } as MessageStreamEvent;

const stepStarted = {
  data: { modelId: "m", sequence: 1, stepIndex: 0, turnId: "turn_1" },
  type: "step.started",
} as MessageStreamEvent;

describe("resumePlanFromEvents", () => {
  it("does not follow a thread that is waiting for the next message", () => {
    expect(resumePlanFromEvents([started, stepStarted, waiting])).toEqual({
      resume: false,
      streamIndex: 3,
    });
  });

  it("does not follow a session that has completed or failed", () => {
    const completed = { type: "session.completed" } as MessageStreamEvent;
    const failed = {
      data: { code: "boom", message: "boom", sessionId: "wrun_A" },
      type: "session.failed",
    } as MessageStreamEvent;

    expect(resumePlanFromEvents([started, completed]).resume).toBe(false);
    expect(resumePlanFromEvents([started, failed]).resume).toBe(false);
  });

  it("follows a thread whose last event is mid-turn", () => {
    expect(resumePlanFromEvents([started, waiting, stepStarted])).toEqual({
      resume: true,
      streamIndex: 3,
    });
  });

  /**
   * A session id with no events is either about to have some or does not exist,
   * and both are eve's question to answer rather than ours.
   */
  it("follows an empty stream", () => {
    expect(resumePlanFromEvents([])).toEqual({ resume: true, streamIndex: 0 });
  });

  /**
   * The cursor has to be exactly the prefix length: eve only starts its own
   * catch-up read at the tail when the two agree, and replays from zero otherwise.
   */
  it("reports the cursor the events end at", () => {
    expect(resumePlanFromEvents([started, stepStarted, waiting]).streamIndex).toBe(3);
  });
});
