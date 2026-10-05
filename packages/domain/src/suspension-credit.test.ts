import { describe, expect, it } from "vitest";
import { type CreditablePeriod, suspensionCreditAmounts } from "./suspension-credit";

/** A thirty-day October period for 1500 cents, renewing. */
const october: CreditablePeriod = {
  start: new Date("2026-10-01T00:00:00.000Z"),
  end: new Date("2026-10-31T00:00:00.000Z"),
  lineAmount: 1500,
  cancelsAt: null,
};
const november: CreditablePeriod = {
  start: october.end,
  end: new Date("2026-11-30T00:00:00.000Z"),
  lineAmount: 1500,
  cancelsAt: null,
};

const lift = (from: string, at: string) => ({
  from: new Date(from),
  at: new Date(at),
  terminated: false,
});

describe("suspensionCreditAmounts (#631)", () => {
  it("credits the suspended share of the period's net amount", () => {
    // Six of thirty days: 1500 x 6 / 30.
    expect(
      suspensionCreditAmounts(
        october,
        lift("2026-10-10T00:00:00.000Z", "2026-10-16T00:00:00.000Z"),
      ),
    ).toEqual({ suspended: 300, remainder: 0 });
  });

  it("rounds down to the cent and still credits a single cent", () => {
    // One hour of 1500 over 720 hours is 2.083 cents.
    expect(
      suspensionCreditAmounts(
        october,
        lift("2026-10-10T00:00:00.000Z", "2026-10-10T01:00:00.000Z"),
      ),
    ).toEqual({ suspended: 2, remainder: 0 });
    // Ten minutes is 0.347 cents: nothing to issue.
    expect(
      suspensionCreditAmounts(
        october,
        lift("2026-10-10T00:00:00.000Z", "2026-10-10T00:10:00.000Z"),
      ),
    ).toEqual({ suspended: 0, remainder: 0 });
  });

  it("splits a suspension across invoices by each one's own period", () => {
    const exit = lift("2026-10-25T00:00:00.000Z", "2026-11-04T12:00:00.000Z");

    // Six days of the October period, four and a half of the next.
    expect(suspensionCreditAmounts(october, exit)).toEqual({ suspended: 300, remainder: 0 });
    expect(suspensionCreditAmounts(november, exit)).toEqual({ suspended: 225, remainder: 0 });
  });

  it("credits nothing for a period the suspension does not overlap", () => {
    expect(
      suspensionCreditAmounts(
        november,
        lift("2026-10-10T00:00:00.000Z", "2026-10-16T00:00:00.000Z"),
      ),
    ).toEqual({ suspended: 0, remainder: 0 });
  });

  it("caps the suspended time at a cancellation that took effect before the exit", () => {
    const cancelled = { ...october, cancelsAt: new Date("2026-10-20T00:00:00.000Z") };

    // Suspended from the 10th, cancelled from the 20th, lifted in November: ten days.
    expect(
      suspensionCreditAmounts(
        cancelled,
        lift("2026-10-10T00:00:00.000Z", "2026-11-04T00:00:00.000Z"),
      ),
    ).toEqual({ suspended: 500, remainder: 0 });
  });

  it("adds a termination's unused remainder to the period end beside the suspended time", () => {
    const terminated = {
      ...lift("2026-10-10T00:00:00.000Z", "2026-10-16T00:00:00.000Z"),
      terminated: true,
    };

    // Six suspended days, then fifteen unused to the end of the period.
    expect(suspensionCreditAmounts(october, terminated)).toEqual({
      suspended: 300,
      remainder: 750,
    });
  });

  it("caps a termination's remainder at the cancellation too", () => {
    const terminated = {
      ...lift("2026-10-10T00:00:00.000Z", "2026-10-16T00:00:00.000Z"),
      terminated: true,
    };
    const cancelled = { ...october, cancelsAt: new Date("2026-10-26T00:00:00.000Z") };

    expect(suspensionCreditAmounts(cancelled, terminated)).toEqual({
      suspended: 300,
      remainder: 500,
    });
  });

  it("returns only the remainder when the suspension started at the termination", () => {
    const at = "2026-10-25T00:00:00.000Z";

    expect(
      suspensionCreditAmounts(october, { from: new Date(at), at: new Date(at), terminated: true }),
    ).toEqual({
      suspended: 0,
      remainder: 300,
    });
  });

  it("rounds the whole once, so the two parts never lose a cent between them", () => {
    // Suspended for 1/3 of a 100-cent period, terminated, so the whole period comes back.
    const period = { ...october, lineAmount: 100 };
    const terminated = {
      from: october.start,
      at: new Date("2026-10-11T00:00:00.000Z"),
      terminated: true,
    };

    expect(suspensionCreditAmounts(period, terminated)).toEqual({ suspended: 33, remainder: 67 });
  });

  it("stays exact for a large annual line", () => {
    const year: CreditablePeriod = {
      start: new Date("2026-01-01T00:00:00.000Z"),
      end: new Date("2027-01-01T00:00:00.000Z"),
      lineAmount: 99_999_999,
      cancelsAt: null,
    };

    // 99_999_999 x 1 ms / 31_536_000_000 ms rounds down to zero.
    expect(
      suspensionCreditAmounts(year, lift("2026-06-01T00:00:00.000Z", "2026-06-01T00:00:00.001Z")),
    ).toEqual({ suspended: 0, remainder: 0 });
    // A full year back is exactly the net amount.
    expect(
      suspensionCreditAmounts(year, lift("2025-12-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z")),
    ).toEqual({ suspended: 99_999_999, remainder: 0 });
  });
});
