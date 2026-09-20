import { routeExplicitConversationalCapture } from "@tendnote/domain/conversational-capture";
import { describe, expect, it } from "vitest";
import { assertTurnOutcomes } from "../evals/cost-replay/outcomes";
import {
  dayIndices,
  type PlannedTurn,
  plannedTurn,
  replayPersonName,
} from "../evals/cost-replay/workload";

const workloads = [
  { turns: 40, captures: 20, people: 15, followups: 10, uploads: 2 },
  { turns: 150, captures: 80, people: 40, followups: 30, uploads: 8 },
  { turns: 600, captures: 300, people: 150, followups: 100, uploads: 30 },
] as const;
const now = new Date("2026-09-19T12:00:00Z");
describe("Representative Month Capture contract", () => {
  it("preserves the original failure as an unsupported fixture, not a successful capture", () => {
    const originalText =
      "I caught up with Replay Friend 2. They mentioned enjoying pottery. Remember their pottery interest as a confirmed private memory. Also create a follow-up for me on 2026-09-23.";
    expect(routeExplicitConversationalCapture({ originalText, timeZone: "UTC", now })).toEqual({
      destination: "saved_item",
    });
  });
  it.each(workloads)(
    "routes explicit requests and preserves the $turns-turn workload",
    (workload) => {
      const steps = Array.from({ length: workload.turns }, (_, index) =>
        plannedTurn(
          workload,
          index,
          {
            id: String(index % workload.people),
            displayName: replayPersonName(index % workload.people),
          },
          now,
        ),
      );
      expect(steps.filter((s) => s.capture)).toHaveLength(workload.captures);
      expect(steps.filter((s) => s.explicit)).toHaveLength(Math.ceil(workload.captures / 4));
      expect(steps.filter((s) => s.followup)).toHaveLength(workload.followups);
      for (const step of steps.filter((s) => s.explicit || s.followup)) assertRoute(step);
    },
  );
});

// A successful tool call or a Saved Item must never substitute for a durable
// person-scoped outcome. These rows are the same shape as the real DB query.

it("rejects the observed Note fallback and accepts a fresh Memory plus correctly dated Follow-Up", () => {
  const step = plannedTurn(workloads[0], 1, { id: "person", displayName: "Avery Alder" }, now);
  expect(step).toMatchObject({ capture: true, explicit: true, followup: true });
  expect(() => assertTurnOutcomes(step, [], [])).toThrow("source");
  const rows = [
    { id: "s", kind: "source" as const, dueDate: null },
    { id: "m", kind: "memory" as const, dueDate: null },
    { id: "f", kind: "followup" as const, dueDate: step.dueDate },
  ];
  expect(() => assertTurnOutcomes(step, [], rows)).not.toThrow();
  expect(() => assertTurnOutcomes(step, rows, rows)).toThrow("source");
  expect(() => assertTurnOutcomes(step, [], rows.slice(0, 2))).toThrow("Follow-Up");
  expect(() =>
    assertTurnOutcomes(
      step,
      [],
      rows.map((r) => (r.kind === "followup" ? { ...r, dueDate: "2020-01-01" } : r)),
    ),
  ).toThrow("date");
});
it("does not promote a casual note into a confirmed Memory", () => {
  const step = plannedTurn(workloads[0], 3, { id: "person", displayName: "Avery Alder" }, now);
  expect(step).toMatchObject({ capture: true, explicit: false, followup: false });
  const source = { id: "s", kind: "source" as const, dueDate: null };
  expect(() => assertTurnOutcomes(step, [], [source])).not.toThrow();
  expect(() =>
    assertTurnOutcomes(step, [], [source, { id: "m", kind: "memory", dueDate: null }]),
  ).toThrow("authority");
});

it.each(["2026-12-20T12:00:00Z", "2028-02-20T12:00:00Z"])(
  "resolves all synthetic-month due dates against the real start clock %s",
  (start) => {
    const clock = new Date(start);
    const workload = workloads[2];
    for (let index = 0; index < workload.turns; index++) {
      const day = Math.ceil(((index + 1) * 30) / workload.turns) - 1;
      const step = plannedTurn(
        workload,
        index,
        { id: "person", displayName: replayPersonName(index % workload.people) },
        new Date(clock.getTime() + day * 86400000),
      );
      if (!step.followup) continue;
      const route = routeExplicitConversationalCapture({
        originalText: step.prompt,
        timeZone: "UTC",
        now: clock,
      });
      const outcomes = route.destination === "group" ? route.outcomes : [route];
      const followup = outcomes.find((outcome) => outcome.destination === "followup");
      expect(followup?.dueAt.toISOString().slice(0, 10)).toBe(step.dueDate);
    }
  },
);

function assertRoute(step: PlannedTurn) {
  const route = routeExplicitConversationalCapture({
    originalText: step.prompt,
    timeZone: "UTC",
    now,
  });
  const outcomes = route.destination === "group" ? route.outcomes : [route];
  expect(outcomes.map((o) => o.destination)).toEqual([
    ...(step.explicit ? ["memory"] : []),
    ...(step.followup ? ["followup"] : []),
  ]);
  for (const outcome of outcomes) {
    if (outcome.destination === "memory" || outcome.destination === "followup")
      expect(outcome.personQuery).toBe(replayPersonName(Number(step.personId)));
    if (outcome.destination === "followup")
      expect(outcome.dueAt.toISOString().slice(0, 10)).toBe(step.dueDate);
  }
}

it("partitions all heavy work without skipping or duplicating day-boundary activity", () => {
  const workload = workloads[2];
  const indices = Array.from({ length: 30 }, (_, day) => dayIndices(day, workload.turns));
  expect(indices.every((day) => day.length === 20)).toBe(true);
  expect(indices.flat()).toEqual(Array.from({ length: 600 }, (_, i) => i));
  expect(Array.from({ length: 30 }, (_, day) => dayIndices(day, workload.uploads)).flat()).toEqual(
    Array.from({ length: 30 }, (_, i) => i),
  );
  const names = Array.from({ length: workload.people }, (_, i) => replayPersonName(i));
  expect(new Set(names).size).toBe(150);
  const steps = indices.flatMap((dayIndices, day) =>
    dayIndices.map((index) =>
      plannedTurn(
        workload,
        index,
        { id: String(index % 150), displayName: replayPersonName(index % 150) },
        new Date(now.getTime() + day * 86400000),
      ),
    ),
  );
  expect(steps.filter((s) => s.capture && !s.explicit)).toHaveLength(225);
  expect(steps.filter((s) => s.explicit)).toHaveLength(75);
  expect(steps.filter((s) => s.followup && !s.capture)).toHaveLength(25);
  expect(steps.filter((s) => !s.capture && !s.followup)).toHaveLength(275);
  // Two real heavy days include the failed attempted turn 30, not a scaled-down mix.
  expect(steps[29]).toMatchObject({ capture: true, explicit: false, followup: false });
  expect(steps.slice(0, 40).filter((s) => s.capture)).toHaveLength(20);
  expect(steps.slice(0, 40).filter((s) => s.followup)).toHaveLength(25);
  // Day eight starts revisiting people; distinct captures must still be new writes.
  expect(steps[151]?.personId).toBe(steps[1]?.personId);
  expect(steps[151]?.prompt).not.toBe(steps[1]?.prompt);
});
