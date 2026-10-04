import { describe, expect, it } from "vitest";
import {
  HOSTED_PLAN,
  interactiveUsageNotice,
  overFairUseBudget,
  type PeriodSpend,
  planCeilingMicroUsd,
  recoveryText,
  spendBreakerCeilingMicroUsd,
  spendBreakerRetryAt,
  spendBreakerStage,
  UsagePausedError,
  usageNotice,
  usageNotices,
  usagePeriod,
  withCeilingOverrides,
} from "./usage-bounds";

describe("usagePeriod", () => {
  it("runs from the anchor day this month to the anchor day next month", () => {
    expect(usagePeriod("2026-03-15", new Date("2026-10-20T12:00:00Z"))).toEqual({
      start: "2026-10-15",
      resetsOn: "2026-11-15",
    });
  });

  it("is still last month's period before the anchor day", () => {
    expect(usagePeriod("2026-03-15", new Date("2026-10-14T23:59:59Z"))).toEqual({
      start: "2026-09-15",
      resetsOn: "2026-10-15",
    });
  });

  it("resets at the start of the anchor day, in UTC", () => {
    expect(usagePeriod("2026-03-15", new Date("2026-10-15T00:00:00Z")).start).toBe("2026-10-15");
  });

  it("clamps an anchor past the end of a shorter month to its last day", () => {
    expect(usagePeriod("2026-01-31", new Date("2027-02-28T09:00:00Z"))).toEqual({
      start: "2027-02-28",
      resetsOn: "2027-03-31",
    });
    expect(usagePeriod("2026-01-31", new Date("2027-02-27T09:00:00Z"))).toEqual({
      start: "2027-01-31",
      resetsOn: "2027-02-28",
    });
    expect(usagePeriod("2026-01-31", new Date("2028-02-29T09:00:00Z")).start).toBe("2028-02-29");
  });

  it("crosses the year boundary", () => {
    expect(usagePeriod("2026-06-20", new Date("2027-01-05T12:00:00Z"))).toEqual({
      start: "2026-12-20",
      resetsOn: "2027-01-20",
    });
  });

  it("resets monthly for an annual subscriber, never once a year", () => {
    // An annual plan bought on 2026-03-15 is billed once, but its allowance
    // resets every month on the 15th all year long.
    const anchor = "2026-03-15";
    const resets = ["2026-04-20", "2026-08-20", "2027-02-20"].map(
      (day) => usagePeriod(anchor, new Date(`${day}T12:00:00Z`)).resetsOn,
    );
    expect(resets).toEqual(["2026-05-15", "2026-09-15", "2027-03-15"]);
  });

  it("starts the first period on the subscription's start day", () => {
    expect(usagePeriod("2026-10-02", new Date("2026-10-02T18:00:00Z"))).toEqual({
      start: "2026-10-02",
      resetsOn: "2026-11-02",
    });
  });
});

describe("usageNotice", () => {
  const resets = { kind: "resets_on", date: "2026-11-15" } as const;

  it("is normal with no restrictions", () => {
    expect(usageNotice([])).toEqual({ state: "normal" });
  });

  it("states the one restriction and its recovery condition", () => {
    expect(usageNotice([{ state: "paused", recovery: resets }])).toEqual({
      state: "paused",
      recovery: resets,
    });
  });

  it("shows the most restrictive state and that state's recovery condition", () => {
    expect(
      usageNotice([
        { state: "reduced", recovery: { kind: "resets_on", date: "2026-11-01" } },
        { state: "paused", recovery: resets },
      ]),
    ).toEqual({ state: "paused", recovery: resets });
  });

  it("shows no billing date while the service-wide restriction applies", () => {
    expect(
      usageNotice([
        { state: "paused", recovery: resets },
        { state: "paused", recovery: { kind: "service_restored" } },
      ]),
    ).toEqual({ state: "paused", recovery: { kind: "service_restored" } });
  });

  it("is recomputed against what remains when a restriction clears", () => {
    const ceiling = { state: "paused", recovery: resets } as const;
    const breaker = { state: "paused", recovery: { kind: "service_restored" } } as const;

    expect(usageNotice([ceiling, breaker]).state).toBe("paused");
    expect(usageNotice([ceiling])).toEqual({ state: "paused", recovery: resets });
    expect(usageNotice([])).toEqual({ state: "normal" });
  });

  it("waits for the latest reset when two restrictions reset on different days", () => {
    expect(
      usageNotice([
        { state: "paused", recovery: resets },
        { state: "paused", recovery: { kind: "resets_on", date: "2026-11-01" } },
      ]),
    ).toEqual({ state: "paused", recovery: resets });
  });

  it("says retrying only when nothing longer applies", () => {
    expect(
      usageNotice([
        { state: "paused", recovery: { kind: "retrying" } },
        { state: "paused", recovery: resets },
      ]),
    ).toEqual({ state: "paused", recovery: resets });
    expect(usageNotice([{ state: "paused", recovery: { kind: "retrying" } }])).toEqual({
      state: "paused",
      recovery: { kind: "retrying" },
    });
  });
});

describe("interactiveUsageNotice", () => {
  const period = { start: "2026-10-15", resetsOn: "2026-11-15" };
  const ceilingMicroUsd = HOSTED_PLAN.allowance.interactive.accountCeilingUsd * 1_000_000;
  const budgetMicroUsd = HOSTED_PLAN.allowance.interactive.fairUseBudgetUsd * 1_000_000;

  it("carries the plan's interactive Fair-Use Budget and Account Ceiling as plan attributes", () => {
    expect(HOSTED_PLAN.allowance.interactive).toEqual({
      fairUseBudgetUsd: 10.5,
      accountCeilingUsd: 12,
    });
  });

  it("is normal below the Fair-Use Budget", () => {
    expect(
      interactiveUsageNotice({ plan: HOSTED_PLAN, period, spentMicroUsd: budgetMicroUsd - 1 }),
    ).toEqual({ state: "normal" });
  });

  it("is reduced from the Fair-Use Budget until the Usage Period resets", () => {
    const reduced = { state: "reduced", recovery: { kind: "resets_on", date: "2026-11-15" } };
    expect(
      interactiveUsageNotice({ plan: HOSTED_PLAN, period, spentMicroUsd: budgetMicroUsd }),
    ).toEqual(reduced);
    expect(
      interactiveUsageNotice({ plan: HOSTED_PLAN, period, spentMicroUsd: ceilingMicroUsd - 1 }),
    ).toEqual(reduced);
  });

  it("pauses at the ceiling until the Usage Period resets", () => {
    expect(
      interactiveUsageNotice({ plan: HOSTED_PLAN, period, spentMicroUsd: ceilingMicroUsd }),
    ).toEqual({ state: "paused", recovery: { kind: "resets_on", date: "2026-11-15" } });
  });

  it("reads the ceiling from the plan it is given", () => {
    const larger = {
      ...HOSTED_PLAN,
      allowance: {
        ...HOSTED_PLAN.allowance,
        interactive: { fairUseBudgetUsd: 18, accountCeilingUsd: 20 },
      },
    };
    expect(
      interactiveUsageNotice({ plan: larger, period, spentMicroUsd: ceilingMicroUsd }).state,
    ).toBe("normal");
  });
});

describe("overFairUseBudget", () => {
  const budgetMicroUsd = HOSTED_PLAN.allowance.interactive.fairUseBudgetUsd * 1_000_000;

  it("is reached at the plan's Fair-Use Budget, and stays reached past the ceiling", () => {
    expect(overFairUseBudget({ plan: HOSTED_PLAN, spentMicroUsd: budgetMicroUsd - 1 })).toBe(false);
    expect(overFairUseBudget({ plan: HOSTED_PLAN, spentMicroUsd: budgetMicroUsd })).toBe(true);
    expect(overFairUseBudget({ plan: HOSTED_PLAN, spentMicroUsd: 13_000_000 })).toBe(true);
  });
});

describe("usageNotices", () => {
  const period = { start: "2026-10-15", resetsOn: "2026-11-15" };
  const paused = { state: "paused", recovery: { kind: "resets_on", date: "2026-11-15" } };
  const spend = (spent: Partial<PeriodSpend["spentMicroUsd"]>): PeriodSpend => ({
    period,
    spentMicroUsd: { interactive: 0, background: 0, web_search: 0, ...spent },
  });

  it("carries the background and web-search ceilings as plan attributes", () => {
    expect(HOSTED_PLAN.allowance.background).toEqual({ accountCeilingUsd: 1.3 });
    expect(HOSTED_PLAN.allowance.webSearch).toEqual({ accountCeilingUsd: 0.7 });
  });

  it("is normal everywhere for an account with no plan", () => {
    expect(usageNotices({ plan: HOSTED_PLAN, spend: null })).toEqual({
      eve: { state: "normal" },
      search: { state: "normal" },
      background: { state: "normal" },
      scheduled: { state: "normal" },
      webSearch: { state: "normal" },
    });
  });

  it("is normal everywhere below every ceiling", () => {
    const notices = usageNotices({
      plan: HOSTED_PLAN,
      spend: spend({ interactive: 1_000_000, background: 1_299_999, web_search: 699_999 }),
    });
    expect(Object.values(notices).every((notice) => notice.state === "normal")).toBe(true);
  });

  it("pauses background work at its ceiling and reduces search to exact results", () => {
    const notices = usageNotices({ plan: HOSTED_PLAN, spend: spend({ background: 1_300_000 }) });

    expect(notices.background).toEqual(paused);
    expect(notices.scheduled).toEqual(paused);
    // Query embeddings share the background allowance, so semantic search goes
    // with it, and exact search is the cheaper substitute that remains.
    expect(notices.search).toEqual({ ...paused, state: "reduced" });
    expect(notices.eve).toEqual({ state: "normal" });
    expect(notices.webSearch).toEqual({ state: "normal" });
  });

  it("pauses web search at its ceiling of one hundred searches, and nothing else", () => {
    const notices = usageNotices({ plan: HOSTED_PLAN, spend: spend({ web_search: 700_000 }) });

    expect(notices.webSearch).toEqual(paused);
    expect(notices.background).toEqual({ state: "normal" });
    expect(notices.search).toEqual({ state: "normal" });
    expect(notices.eve).toEqual({ state: "normal" });
  });

  it("gives interactive Eve the same notice as interactiveUsageNotice", () => {
    expect(
      usageNotices({ plan: HOSTED_PLAN, spend: spend({ interactive: 12_000_000 }) }).eve,
    ).toEqual(paused);
  });

  it("counts each category against its own ceiling only", () => {
    const notices = usageNotices({
      plan: HOSTED_PLAN,
      spend: spend({ interactive: 11_000_000, web_search: 0, background: 0 }),
    });
    expect(notices.background.state).toBe("normal");
    expect(notices.webSearch.state).toBe("normal");
  });
});

describe("UsagePausedError", () => {
  it("names the day the paused function resumes, at the start of that UTC day", () => {
    const error = UsagePausedError.atCeiling("2026-11-15");

    expect(error).toBeInstanceOf(Error);
    expect(error.recovery).toEqual({ kind: "resets_on", date: "2026-11-15" });
    expect(error.resumesAt).toEqual(new Date("2026-11-15T00:00:00Z"));
    expect(error.message).toContain("Resets on November 15.");
  });

  it("names no date while the Spend Breaker sheds, and retries when its day ends", () => {
    const retryAt = new Date("2026-10-21T00:00:00Z");
    const error = UsagePausedError.byBreaker(retryAt);

    expect(error.recovery).toEqual({ kind: "service_restored" });
    expect(error.resumesAt).toEqual(retryAt);
    expect(error.message).toContain("Resumes when service is restored.");
    expect(error.message).not.toMatch(/month|Resets on/);
  });
});

describe("recoveryText", () => {
  it("states the reset day for the Usage Period", () => {
    expect(recoveryText({ kind: "resets_on", date: "2026-11-15" })).toBe("Resets on November 15.");
  });

  it("reads the reset day as a calendar day, whatever the viewer's time zone", () => {
    expect(recoveryText({ kind: "resets_on", date: "2026-12-01" })).toBe("Resets on December 1.");
  });

  it("gives no date while service is being restored", () => {
    expect(recoveryText({ kind: "service_restored" })).toBe("Resumes when service is restored.");
  });

  it("says retrying for a queued retry", () => {
    expect(recoveryText({ kind: "retrying" })).toBe("Retrying.");
  });
});

describe("spendBreakerCeilingMicroUsd", () => {
  it("is twice every admitted account's daily ceiling pace, plus $5.00 for the operator", () => {
    // 2 x (10 x $14.00 / 30) + $5.00 = $14.33...
    expect(spendBreakerCeilingMicroUsd(10)).toBe(14_333_333);
    expect(spendBreakerCeilingMicroUsd(1)).toBe(5_933_333);
    expect(spendBreakerCeilingMicroUsd(300)).toBe(285_000_000);
  });

  it("is the operator's $5.00 alone with no admitted accounts", () => {
    expect(spendBreakerCeilingMicroUsd(0)).toBe(5_000_000);
  });

  it("follows the plan's summed Account Ceilings", () => {
    const larger = {
      allowance: {
        interactive: { fairUseBudgetUsd: 18, accountCeilingUsd: 25 },
        background: { accountCeilingUsd: 3 },
        webSearch: { accountCeilingUsd: 2 },
      },
    };
    // 2 x (3 x $30.00 / 30) + $5.00
    expect(spendBreakerCeilingMicroUsd(3, larger)).toBe(11_000_000);
  });
});

describe("spendBreakerStage", () => {
  const ceilingMicroUsd = 10_000_000;

  it("stays closed below the ceiling", () => {
    expect(spendBreakerStage({ ceilingMicroUsd, spentMicroUsd: 9_999_999 })).toBe("closed");
  });

  it("sheds in the fixed order as spend keeps climbing past the ceiling", () => {
    const at = (spentMicroUsd: number) => spendBreakerStage({ ceilingMicroUsd, spentMicroUsd });

    expect(at(10_000_000)).toBe("background");
    expect(at(12_499_999)).toBe("background");
    expect(at(12_500_000)).toBe("scheduled");
    expect(at(14_999_999)).toBe("scheduled");
    expect(at(15_000_000)).toBe("interactive");
    expect(at(1_000_000_000)).toBe("interactive");
  });
});

describe("spendBreakerRetryAt", () => {
  it("is the next UTC midnight, when the breaker's day ends", () => {
    expect(spendBreakerRetryAt(new Date("2026-10-20T00:00:00Z"))).toEqual(
      new Date("2026-10-21T00:00:00Z"),
    );
    expect(spendBreakerRetryAt(new Date("2026-12-31T23:59:59Z"))).toEqual(
      new Date("2027-01-01T00:00:00Z"),
    );
  });
});

describe("usageNotices under the Spend Breaker", () => {
  const period = { start: "2026-10-15", resetsOn: "2026-11-15" };
  const restored = { state: "paused", recovery: { kind: "service_restored" } } as const;
  const normal = { state: "normal" } as const;
  const spend = (spent: Partial<PeriodSpend["spentMicroUsd"]>): PeriodSpend => ({
    period,
    spentMicroUsd: { interactive: 0, background: 0, web_search: 0, ...spent },
  });

  it("changes nothing while the breaker is closed", () => {
    expect(usageNotices({ plan: HOSTED_PLAN, spend: spend({}), breaker: "closed" })).toEqual(
      usageNotices({ plan: HOSTED_PLAN, spend: spend({}) }),
    );
  });

  it("sheds background work first, reducing search to exact results", () => {
    expect(usageNotices({ plan: HOSTED_PLAN, spend: spend({}), breaker: "background" })).toEqual({
      eve: normal,
      search: { ...restored, state: "reduced" },
      background: restored,
      scheduled: normal,
      webSearch: normal,
    });
  });

  it("sheds scheduled workflows second, with interactive Eve still running", () => {
    const notices = usageNotices({ plan: HOSTED_PLAN, spend: spend({}), breaker: "scheduled" });

    expect(notices.background).toEqual(restored);
    expect(notices.scheduled).toEqual(restored);
    expect(notices.eve).toEqual(normal);
  });

  it("sheds interactive Eve last", () => {
    const notices = usageNotices({ plan: HOSTED_PLAN, spend: spend({}), breaker: "interactive" });

    expect(notices.eve).toEqual(restored);
    expect(notices.scheduled).toEqual(restored);
    expect(notices.background).toEqual(restored);
  });

  it("covers an account with no plan, such as the operator's", () => {
    expect(usageNotices({ plan: HOSTED_PLAN, spend: null, breaker: "interactive" }).eve).toEqual(
      restored,
    );
  });

  it("shows no reset date for a function it sheds, even past the account's own ceiling", () => {
    const notices = usageNotices({
      plan: HOSTED_PLAN,
      spend: spend({ interactive: 12_000_000, background: 1_300_000 }),
      breaker: "background",
    });

    expect(notices.background).toEqual(restored);
    expect(notices.search).toEqual({ ...restored, state: "reduced" });
    // Interactive Eve is not shed yet, so its own ceiling's reset day stands.
    expect(notices.eve).toEqual({
      state: "paused",
      recovery: { kind: "resets_on", date: "2026-11-15" },
    });
  });

  it("keeps Eve paused rather than reduced when the breaker sheds an account on the Fallback Model", () => {
    const notices = usageNotices({
      plan: HOSTED_PLAN,
      spend: spend({ interactive: 11_000_000 }),
      breaker: "interactive",
    });
    expect(notices.eve).toEqual(restored);
  });

  it("returns to the account's own ceilings once the breaker closes", () => {
    const over = spend({ background: 1_300_000 });
    const shed = usageNotices({ plan: HOSTED_PLAN, spend: over, breaker: "scheduled" });
    const closed = usageNotices({ plan: HOSTED_PLAN, spend: over, breaker: "closed" });

    expect(shed.background.state === "paused" && shed.background.recovery.kind).toBe(
      "service_restored",
    );
    expect(closed.background).toEqual({
      state: "paused",
      recovery: { kind: "resets_on", date: "2026-11-15" },
    });
  });

  it("never sheds web search on its own: it runs only inside a turn the door refuses", () => {
    expect(
      usageNotices({ plan: HOSTED_PLAN, spend: spend({}), breaker: "interactive" }).webSearch,
    ).toEqual(normal);
  });
});

describe("withCeilingOverrides (#633)", () => {
  it("raises each overridden category's Account Ceiling, leaving the rest and the Fair-Use Budget", () => {
    const plan = withCeilingOverrides(HOSTED_PLAN, {
      background: 2_600_000,
      web_search: 1_400_000,
    });

    expect(plan.allowance).toEqual({
      interactive: { fairUseBudgetUsd: 10.5, accountCeilingUsd: 12 },
      background: { accountCeilingUsd: 2.6 },
      webSearch: { accountCeilingUsd: 1.4 },
    });
    expect(planCeilingMicroUsd(plan, "web_search")).toBe(1_400_000);
    expect(HOSTED_PLAN.allowance.background.accountCeilingUsd).toBe(1.3);
  });

  it("never lowers a ceiling", () => {
    expect(withCeilingOverrides(HOSTED_PLAN, { interactive: 5_000_000 })).toEqual(HOSTED_PLAN);
  });
});
