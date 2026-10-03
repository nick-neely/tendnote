import { describe, expect, it } from "vitest";
import {
  ACCOUNT_FUNNEL_STAGES,
  type AccountFunnelReportData,
  accountFunnelCohort,
  accountFunnelEventCutoff,
  isTelemetryEligibleCountry,
  renderAccountFunnelReport,
} from "./account-funnel";
import { ACTIVATION_MILESTONES } from "./activation-milestones";

describe("the account funnel stage set", () => {
  it("is closed, in funnel order, and ends with the Activation Milestones", () => {
    expect(ACCOUNT_FUNNEL_STAGES).toEqual([
      "signup_completed",
      "checkout_started",
      "payment_confirmed",
      "paid_access_granted",
      ...ACTIVATION_MILESTONES,
    ]);
  });
});

describe("telemetry region eligibility", () => {
  it("collects only for a country known to be the US", () => {
    expect(isTelemetryEligibleCountry("US")).toBe(true);
    expect(isTelemetryEligibleCountry("us")).toBe(true);
  });

  it.each([null, undefined, "", "CA", "GB", "DE", "XX"])("suppresses %s", (country) => {
    expect(isTelemetryEligibleCountry(country)).toBe(false);
  });
});

describe("the report cohort", () => {
  it("reads grouped counts and shows a stage no account reached as zero", () => {
    const cohort = accountFunnelCohort([
      { stage: "signup_completed", accounts: 4 },
      { stage: "first_value_reached", accounts: 1 },
    ]);

    expect(cohort.signup_completed).toBe(4);
    expect(cohort.first_value_reached).toBe(1);
    expect(cohort.checkout_started).toBe(0);
    expect(Object.keys(cohort)).toEqual([...ACCOUNT_FUNNEL_STAGES]);
  });
});

describe("funnel event retention", () => {
  it("keeps ninety days, read from the retention constant", () => {
    expect(accountFunnelEventCutoff(new Date("2026-10-03T12:00:00.000Z"))).toEqual(
      new Date("2026-07-05T12:00:00.000Z"),
    );
  });
});

function report(overrides: Partial<AccountFunnelReportData> = {}): string {
  const cohort = Object.fromEntries(
    ACCOUNT_FUNNEL_STAGES.map((stage) => [stage, 0]),
  ) as AccountFunnelReportData["cohort"];
  return renderAccountFunnelReport({
    since: new Date("2026-09-03T00:00:00.000Z"),
    until: new Date("2026-10-03T00:00:00.000Z"),
    cohort: { ...cohort, signup_completed: 8, checkout_started: 6, first_value_reached: 2 },
    accountsCreated: 10,
    accountsOptedOut: 1,
    ...overrides,
  });
}

describe("the saved operator report", () => {
  it("shows each stage against the signup cohort", () => {
    const text = report();

    expect(text).toMatch(/Signup completed\s+8\s+100%/);
    expect(text).toMatch(/Checkout started\s+6\s+75%/);
    expect(text).toMatch(/First Value reached\s+2\s+25%/);
  });

  it("keeps the account funnel and public activity in separate sections", () => {
    const text = report();
    const funnel = text.indexOf("ACCOUNT FUNNEL");
    const publicActivity = text.indexOf("PUBLIC ACTIVITY");

    expect(funnel).toBeGreaterThan(-1);
    expect(publicActivity).toBeGreaterThan(funnel);
    expect(text.slice(publicActivity)).toMatch(/never joined to accounts/);
    expect(text.slice(publicActivity)).toMatch(/not unique-person conversion rates/);
  });

  it("states its coverage gaps", () => {
    const text = report();

    expect(text).toMatch(/8 of 10 accounts created in the window are in this funnel/);
    expect(text).toMatch(
      /outside a known-US region, had opted out, or their\s+event was not recorded/,
    );
    expect(text).toMatch(/1 account with analytics switched off/);
    expect(text).toMatch(/never backfilled from Activation Milestones/);
    expect(text).toMatch(/Events are deleted after 90 days/);
    expect(text).toMatch(/not a billing or admission ledger/);
    expect(text).toMatch(/first enrolled at checkout has no\s+signup event/);
  });

  it("shows no ratio for an empty cohort", () => {
    const text = report({
      cohort: Object.fromEntries(
        ACCOUNT_FUNNEL_STAGES.map((stage) => [stage, 0]),
      ) as AccountFunnelReportData["cohort"],
    });

    expect(text).toMatch(/Signup completed\s+0\s+-/);
  });
});
