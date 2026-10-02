import { describe, expect, it } from "vitest";
import { usageLedgerCutoffDay, usageLedgerDay } from "./usage-ledger";

describe("usageLedgerDay", () => {
  it("is the UTC calendar day of the call", () => {
    expect(usageLedgerDay(new Date("2026-10-02T23:59:59.999Z"))).toBe("2026-10-02");
    expect(usageLedgerDay(new Date("2026-10-03T00:00:00.000Z"))).toBe("2026-10-03");
  });
});

describe("usageLedgerCutoffDay", () => {
  it("keeps thirteen months of days", () => {
    expect(usageLedgerCutoffDay(new Date("2026-10-02T12:00:00Z"))).toBe("2025-09-02");
  });

  it("clamps to the end of a shorter month", () => {
    expect(usageLedgerCutoffDay(new Date("2027-03-31T12:00:00Z"))).toBe("2026-02-28");
  });
});
