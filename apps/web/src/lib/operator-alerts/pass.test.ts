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

  const unread = { backgroundBacklog: null, remindersLate: null, firstValue: null };

  it("reads each condition from what the cron pass found", () => {
    expect(
      operatorAlertReadings({
        stripeReconciliation: ran(0, 1),
        deletionStuck: false,
        breaker: "background",
        backupSurfaces: { status: "ran", findings: [] },
        ...unread,
      }),
    ).toEqual([
      { condition: "account_deletion_stuck", firing: false },
      { condition: "stripe_reconciliation", firing: true },
      { condition: "spend_breaker", firing: true },
      { condition: "backup_surface", firing: false },
    ]);
    expect(
      operatorAlertReadings({
        stripeReconciliation: ran(2, 0),
        deletionStuck: true,
        breaker: "closed",
        backupSurfaces: {
          status: "ran",
          findings: [{ surface: "snapshot", id: "snap-one", name: "before migration" }],
        },
        ...unread,
      }),
    ).toEqual([
      { condition: "account_deletion_stuck", firing: true },
      { condition: "stripe_reconciliation", firing: true },
      { condition: "spend_breaker", firing: false },
      { condition: "backup_surface", firing: true },
    ]);
    expect(
      operatorAlertReadings({
        stripeReconciliation: ran(0, 0),
        deletionStuck: false,
        breaker: "closed",
        backupSurfaces: null,
        ...unread,
      }),
    ).toContainEqual({ condition: "stripe_reconciliation", firing: false });
  });

  it("gives no reading for a read that failed or a stage that did not run, so its alert holds", () => {
    for (const backupSurfaces of [null, { status: "off" as const }]) {
      expect(
        operatorAlertReadings({
          stripeReconciliation: { status: "skipped" },
          deletionStuck: null,
          breaker: null,
          backupSurfaces,
          ...unread,
        }),
      ).toEqual([]);
    }
    expect(
      operatorAlertReadings({
        stripeReconciliation: { status: "skipped" },
        deletionStuck: null,
        breaker: null,
        backupSurfaces: null,
        ...unread,
        firstValue: { status: "off" },
      }),
    ).toEqual([]);
  });

  it("reads the Reliability Indicators, holding the grounded answer on passes that do not ask it", () => {
    const base = {
      stripeReconciliation: { status: "skipped" as const },
      deletionStuck: null,
      breaker: null,
      backupSurfaces: null,
    };
    expect(
      operatorAlertReadings({
        ...base,
        backgroundBacklog: true,
        remindersLate: false,
        firstValue: { status: "ran", failed: ["checkout"], groundedAnswer: null },
      }),
    ).toEqual([
      { condition: "background_backlog", firing: true },
      { condition: "reminder_lateness", firing: false },
      { condition: "first_value_path", firing: true },
    ]);
    expect(
      operatorAlertReadings({
        ...base,
        backgroundBacklog: false,
        remindersLate: true,
        firstValue: { status: "ran", failed: [], groundedAnswer: false },
      }),
    ).toEqual([
      { condition: "background_backlog", firing: false },
      { condition: "reminder_lateness", firing: true },
      { condition: "first_value_path", firing: false },
      { condition: "grounded_eve_answer", firing: true },
    ]);
    expect(
      operatorAlertReadings({
        ...base,
        ...unread,
        firstValue: { status: "ran", failed: [], groundedAnswer: true },
      }),
    ).toContainEqual({ condition: "grounded_eve_answer", firing: false });
  });
});
