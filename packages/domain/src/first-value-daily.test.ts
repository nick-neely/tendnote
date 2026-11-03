import { describe, expect, it } from "vitest";
import {
  advanceFirstValue,
  claimFirstValueDailyRun,
  FIRST_VALUE_DAILY_RUN_LIMIT,
  FIRST_VALUE_POLICY,
  firstValueStateFor,
} from "./first-value-daily";
import {
  emptyFirstValueHealth,
  FIRST_VALUE_INTERVAL_MS,
  type FirstValueHealthState,
  type FirstValueOutcome,
} from "./first-value-health";

/** 15:00 UTC, the daily hour, on a fixed day. */
const DAY_START = Date.parse("2026-11-02T15:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const slot = (n: number, day = 0) =>
  new Date(DAY_START + day * DAY_MS + n * FIRST_VALUE_INTERVAL_MS);

/** A fake clock over one persisted state and the incident it implies. */
function harness(state: FirstValueHealthState = emptyFirstValueHealth(), incidentOpen = false) {
  const h = {
    state,
    incidentOpen,
    claim(at: Date) {
      const claim = claimFirstValueDailyRun(h.state, at);
      h.state = claim.state;
      return claim.claimed;
    },
    complete(outcome: FirstValueOutcome, at: Date, delayMs = 1_000) {
      const decision = advanceFirstValue("daily", {
        state: h.state,
        sample: { at, outcome },
        now: new Date(at.getTime() + delayMs),
        incidentOpen: h.incidentOpen,
      });
      h.state = decision.state;
      if (decision.availability === "open") h.incidentOpen = true;
      if (decision.availability === "clear") h.incidentOpen = false;
      return decision;
    },
    /** One cron pass: claim, and when claimed, complete with `outcome`. */
    pass(outcome: FirstValueOutcome, at: Date) {
      return h.claim(at) ? h.complete(outcome, at) : null;
    },
  };
  return h;
}

describe("the prelaunch daily First Value policy", () => {
  it("is the policy in force before paid launch", () => {
    expect(FIRST_VALUE_POLICY).toBe("daily");
  });

  it("claims the first pass at or after 15:00 UTC, once per UTC day", () => {
    const h = harness();
    expect(h.claim(new Date(DAY_START - 1))).toBe(false);
    expect(h.pass("clean", slot(0))?.availability).toBe("clear");
    for (let n = 1; n < 54; n += 1) expect(h.claim(slot(n))).toBe(false);
    // Midnight to 15:00 the next day belongs to no run.
    expect(h.claim(new Date(DAY_START + DAY_MS - 1))).toBe(false);
    expect(h.claim(slot(0, 1))).toBe(true);
  });

  it("makes up a pass that missed 15:00, and a day the cron missed entirely", () => {
    const h = harness();
    expect(h.claim(slot(7))).toBe(true);
    expect(h.state.daily).toMatchObject({ day: "2026-11-02", runs: 1 });
    h.complete("clean", slot(7));
    // No pass at all on day 1: day 2 starts its own count.
    expect(h.claim(slot(3, 2))).toBe(true);
    expect(h.state.daily).toMatchObject({ day: "2026-11-04", runs: 1 });
  });

  it("lets concurrent passes claim a run once, until its lease expires", () => {
    const h = harness();
    const first = claimFirstValueDailyRun(h.state, slot(0));
    const racer = claimFirstValueDailyRun(first.state, slot(0));
    expect([first.claimed, racer.claimed]).toEqual([true, false]);
    h.state = racer.state;
    // The claimed run never completed (the function died): a later pass makes it up.
    expect(h.claim(slot(1))).toBe(false);
    expect(h.claim(slot(2))).toBe(true);
    expect(h.state.daily).toMatchObject({ runs: 2, claimedAt: slot(2).getTime() });
  });

  it("bounds a day's runs, so failures to read never multiply paid checks", () => {
    const h = harness();
    let claims = 0;
    for (let n = 0; n < 54; n += 1) {
      if (h.claim(slot(n))) {
        claims += 1;
        expect(h.complete("unknown", slot(n)).availability).toBe("hold");
      }
    }
    expect(claims).toBe(FIRST_VALUE_DAILY_RUN_LIMIT);
    expect(h.state.daily).toMatchObject({ settled: false, runs: 3 });
    expect(h.incidentOpen).toBe(false);
  });

  it("accepts only the claimed run's fresh completion", () => {
    const h = harness();
    // Nothing claimed: an unclaimed result never moves the state.
    expect(h.complete("serious", slot(0))).toMatchObject({ availability: "hold" });
    expect(h.state.daily?.claimedAt ?? null).toBeNull();

    h.claim(slot(0));
    // Stale: more than five minutes from check start to policy read.
    expect(h.complete("clean", slot(0), 300_001).availability).toBe("hold");
    expect(h.complete("clean", slot(0), -1).availability).toBe("hold");
    expect(h.state.daily?.settled).toBe(false);
    // Superseded by a make-up claim, the original's late result is out of order.
    h.claim(slot(2));
    expect(h.complete("serious", slot(0), 1_000).availability).toBe("hold");
    expect(h.complete("serious", slot(2)).availability).toBe("open");
    // A duplicate delivery of the same completion counts once.
    expect(h.complete("serious", slot(2)).availability).toBe("hold");
  });

  it("opens a serious failure at once and keeps it until a clean daily check", () => {
    const h = harness();
    expect(h.pass("serious", slot(0))).toMatchObject({
      availability: "open",
      openedAt: slot(0),
      context: { samples: 1, failed: 0, retried: 0 },
    });
    expect(h.claim(slot(1))).toBe(false);
    expect(h.pass("retried", slot(0, 1))?.availability).toBe("hold");
    expect(h.pass("clean", slot(0, 2))?.availability).toBe("clear");
  });

  it("confirms a transient failure on the next pass with the first failure's time", () => {
    const h = harness();
    expect(h.pass("failed", slot(0))?.availability).toBe("hold");
    expect(h.pass("failed", slot(1))).toMatchObject({
      availability: "open",
      openedAt: slot(0),
      context: { samples: 2, failed: 2, retried: 0, sampledAt: slot(1).toISOString() },
    });
    expect(h.claim(slot(2))).toBe(false);
  });

  it("dismisses an unconfirmed failure without recovering, and settles the day", () => {
    for (const later of ["clean", "retried"] as const) {
      const h = harness(emptyFirstValueHealth(), true);
      h.pass("failed", slot(0));
      expect(h.pass(later, slot(1))?.availability).toBe("hold");
      expect(h.incidentOpen).toBe(true);
      expect(h.claim(slot(2))).toBe(false);
      expect(h.pass("failed", slot(0, 1))?.availability).toBe("hold");
    }
  });

  it("carries a failure from the day's last run into the next day's check", () => {
    const h = harness();
    h.pass("unknown", slot(0));
    h.pass("unknown", slot(2));
    h.pass("failed", slot(4));
    expect(h.claim(slot(6))).toBe(false);
    expect(h.pass("failed", slot(0, 1))).toMatchObject({ availability: "open", openedAt: slot(4) });
  });

  it("an unknown run neither confirms nor dismisses a pending failure", () => {
    const h = harness();
    h.pass("failed", slot(0));
    expect(h.pass("unknown", slot(1))?.availability).toBe("hold");
    expect(h.pass("failed", slot(2))).toMatchObject({ availability: "open", openedAt: slot(0) });
  });
});

describe("First Value policy transitions", () => {
  it("leaves state written by the same policy untouched", () => {
    const tenMinute = emptyFirstValueHealth();
    expect(firstValueStateFor("ten_minute", tenMinute)).toBe(tenMinute);
    const daily = firstValueStateFor("daily", tenMinute);
    expect(firstValueStateFor("daily", daily)).toBe(daily);
  });

  it("discards ten-minute samples instead of reading them as daily ones", () => {
    const state: FirstValueHealthState = {
      history: [
        { slot: slot(0).getTime(), at: slot(0).getTime(), outcome: "failed" },
        { slot: slot(1).getTime(), at: slot(1).getTime(), outcome: "failed" },
      ],
      lastSummaryAt: slot(-6).getTime(),
      recoveredThroughSlot: slot(-12).getTime(),
    };
    expect(firstValueStateFor("daily", state)).toEqual({
      history: [],
      lastSummaryAt: slot(-6).getTime(),
      recoveredThroughSlot: null,
      policy: "daily",
      daily: { day: null, runs: 0, claimedAt: null, settled: false, unconfirmedFailureAt: null },
    });
  });

  it("never recovers an incident open at the transition without a clean daily check", () => {
    const h = harness(
      {
        history: [{ slot: slot(-1).getTime(), at: slot(-1).getTime(), outcome: "clean" }],
        lastSummaryAt: null,
      },
      true,
    );
    // The last ten-minute sample was clean, but it is not a daily one.
    expect(h.pass("retried", slot(0))?.availability).toBe("hold");
    expect(h.incidentOpen).toBe(true);
    expect(h.pass("clean", slot(0, 1))?.availability).toBe("clear");
  });

  it("restores the ten-minute window empty, so an open incident needs two clean slots", () => {
    const daily = harness(emptyFirstValueHealth(), true);
    daily.pass("failed", slot(0));
    let state = daily.state;
    const sample = (outcome: FirstValueOutcome, n: number) => {
      const decision = advanceFirstValue("ten_minute", {
        state,
        sample: { at: slot(n), outcome },
        now: slot(n),
        incidentOpen: true,
      });
      state = decision.state;
      return decision.availability;
    };
    expect(sample("clean", 1)).toBe("hold");
    expect(state).toMatchObject({ policy: "ten_minute", history: [{ outcome: "clean" }] });
    expect(state.daily).toBeUndefined();
    expect(sample("clean", 2)).toBe("clear");
  });
});
