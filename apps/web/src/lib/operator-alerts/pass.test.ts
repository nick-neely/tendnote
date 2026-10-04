import { describe, expect, it } from "vitest";
import { operatorAlertReadings } from "./pass";

describe("operatorAlertReadings", () => {
  const ran = (failed: number, unmatchedRefunds: number) => ({
    status: "ran" as const,
    scanned: 0,
    admitted: 0,
    dunningClosed: 0,
    revoked: 0,
    unknownCustomer: 0,
    failed,
    unmatchedRefunds,
  });

  it("reads each condition from what the cron pass found", () => {
    expect(
      operatorAlertReadings({
        stripeReconciliation: ran(0, 1),
        deletionStuck: false,
        breaker: "background",
      }),
    ).toEqual([
      { condition: "account_deletion_stuck", firing: false },
      { condition: "stripe_reconciliation", firing: true },
      { condition: "spend_breaker", firing: true },
    ]);
    expect(
      operatorAlertReadings({
        stripeReconciliation: ran(2, 0),
        deletionStuck: true,
        breaker: "closed",
      }),
    ).toEqual([
      { condition: "account_deletion_stuck", firing: true },
      { condition: "stripe_reconciliation", firing: true },
      { condition: "spend_breaker", firing: false },
    ]);
    expect(
      operatorAlertReadings({
        stripeReconciliation: ran(0, 0),
        deletionStuck: false,
        breaker: "closed",
      }),
    ).toContainEqual({ condition: "stripe_reconciliation", firing: false });
  });

  it("gives no reading for a read that failed or a stage that did not run, so its alert holds", () => {
    expect(
      operatorAlertReadings({
        stripeReconciliation: { status: "skipped" },
        deletionStuck: null,
        breaker: null,
      }),
    ).toEqual([]);
  });
});
