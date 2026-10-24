import { describe, expect, it } from "vitest";
import {
  advanceFirstValueHealth,
  emptyFirstValueHealth,
  FIRST_VALUE_INTERVAL_MS,
  type FirstValueOutcome,
} from "./first-value-health";

const start = Date.parse("2026-10-23T20:00:00Z");

function harness() {
  let state = emptyFirstValueHealth();
  let incidentOpen = false;
  function sample(outcome: FirstValueOutcome, slot: number, delayMs = 0) {
    const at = new Date(start + slot * FIRST_VALUE_INTERVAL_MS);
    const decision = advanceFirstValueHealth({
      state,
      sample: { at, outcome },
      now: new Date(at.getTime() + delayMs),
      incidentOpen,
    });
    state = decision.state;
    if (decision.availability === "open") incidentOpen = true;
    if (decision.availability === "clear") incidentOpen = false;
    return decision;
  }
  return { sample, state: () => state };
}

describe("First Value scheduled-sample policy", () => {
  it("holds an isolated failure and confirms two failed slots, retaining the first sample date", () => {
    const h = harness();
    expect(h.sample("failed", 0).availability).toBe("hold");
    expect(h.sample("failed", 1)).toMatchObject({
      availability: "open",
      openedAt: new Date(start),
      context: { samples: 2, failed: 2, retried: 0 },
    });
  });

  it("detects three alternating failures in six expected slots", () => {
    const h = harness();
    for (const [slot, outcome] of (["failed", "clean", "failed", "clean"] as const).entries()) {
      expect(h.sample(outcome, slot).availability).not.toBe("open");
    }
    expect(h.sample("failed", 4).availability).toBe("open");
  });

  it("does not carry failures or consecutive streaks across gaps or expired slots", () => {
    const h = harness();
    h.sample("failed", 0);
    expect(h.sample("failed", 2).availability).toBe("hold");
    expect(h.sample("failed", 6).availability).toBe("hold");
    expect(h.state().history.map((s) => s.slot)).toHaveLength(2);
  });

  it("requires two adjacent clean first-attempt samples, holding through retries and unknowns", () => {
    const h = harness();
    h.sample("serious", 0);
    h.sample("clean", 1);
    expect(h.sample("retried", 2).availability).toBe("hold");
    h.sample("clean", 3);
    expect(h.sample("unknown", 4).availability).toBe("hold");
    expect(h.sample("clean", 5).availability).toBe("hold");
    expect(h.sample("clean", 7).availability).toBe("hold");
    expect(h.sample("clean", 8).availability).toBe("clear");
  });

  it("rejects duplicate, older, stale and future samples without advancing recovery", () => {
    const h = harness();
    h.sample("serious", 0);
    h.sample("clean", 1);
    const before = h.state();
    for (const [slot, delay] of [
      [1, 0],
      [0, 0],
      [2, 300_001],
      [2, -1],
    ] as const) {
      expect(h.sample("clean", slot, delay)).toEqual({ state: before, availability: "hold" });
    }
    expect(h.sample("clean", 3).availability).toBe("hold");
  });

  it("reports serious failures immediately even after a healthy or unknown sample", () => {
    const h = harness();
    h.sample("unknown", 0);
    expect(h.sample("serious", 1).availability).toBe("open");
  });

  it("lets serious evidence win a racing same-slot success without counting a second check", () => {
    const h = harness();
    h.sample("clean", 0);
    expect(h.sample("serious", 0).availability).toBe("open");
    expect(h.state().history).toHaveLength(1);
    expect(h.sample("clean", 0).availability).toBe("hold");
  });

  it("summarizes repeated degradation once per six hours and never duplicates an incident", () => {
    const h = harness();
    h.sample("failed", 0);
    h.sample("retried", 1);
    expect(h.sample("retried", 2).summary).toMatchObject({ failed: 1, retried: 2, samples: 3 });
    expect(h.sample("retried", 3).summary).toBeUndefined();
    h.sample("retried", 36);
    h.sample("retried", 37);
    expect(h.sample("retried", 38).summary).toMatchObject({ retried: 3 });
    const incident = harness();
    incident.sample("failed", 0);
    incident.sample("failed", 1);
    expect(incident.sample("retried", 2).summary).toBeUndefined();
  });

  it("replays the investigated nineteen slots as one summary and no availability incident", () => {
    const h = harness();
    const series: FirstValueOutcome[] = [
      "clean",
      "clean",
      "failed",
      "clean",
      "clean",
      "clean",
      "retried",
      "retried",
      "clean",
      "clean",
      "clean",
      "retried",
      "clean",
      "clean",
      "clean",
      "clean",
      "clean",
      "failed",
      "clean",
    ];
    const decisions = series.map((outcome, slot) => h.sample(outcome, slot));
    expect(decisions.filter((d) => d.availability === "open")).toHaveLength(0);
    expect(decisions.flatMap((d, slot) => (d.summary ? [slot] : []))).toEqual([7]);
  });
});
