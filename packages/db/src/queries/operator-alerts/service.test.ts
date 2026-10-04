import type { OperatorAlertNotice, OperatorAlertReading } from "@tendnote/domain/operator-alerts";
import type { SpendBreakerStage } from "@tendnote/domain/usage-bounds";
import { describe, expect, it } from "vitest";
import { createInMemoryOperatorAlertStore } from "./in-memory-store";
import { runOperatorAlertPass } from "./service";

function harness() {
  const { store, episodes } = createInMemoryOperatorAlertStore();
  const sent: OperatorAlertNotice[] = [];
  let failing = false;
  const errors: string[] = [];

  async function pass(
    readings: OperatorAlertReading[],
    breaker: SpendBreakerStage | null = "closed",
  ) {
    return runOperatorAlertPass({
      store,
      readings,
      breaker,
      notify: async ({ kind, condition }) => {
        if (failing) throw new Error("unreachable");
        sent.push({ kind, condition });
      },
      logger: { error: (message) => errors.push(message) },
    });
  }

  return {
    pass,
    sent,
    episodes,
    errors,
    failSends(value: boolean) {
      failing = value;
    },
  };
}

const firing = (condition: OperatorAlertReading["condition"]) => ({ condition, firing: true });
const clear = (condition: OperatorAlertReading["condition"]) => ({ condition, firing: false });

describe("runOperatorAlertPass", () => {
  it("alerts once while a condition keeps firing, then sends one recovery notice", async () => {
    const alerts = harness();

    await alerts.pass([firing("stripe_reconciliation")]);
    await alerts.pass([firing("stripe_reconciliation")]);
    await alerts.pass([firing("stripe_reconciliation")]);
    await alerts.pass([clear("stripe_reconciliation")]);
    await alerts.pass([clear("stripe_reconciliation")]);

    expect(alerts.sent).toEqual([
      { kind: "alert", condition: "stripe_reconciliation" },
      { kind: "recovery", condition: "stripe_reconciliation" },
    ]);
  });

  it("deduplicates each condition separately and alerts again on a new episode", async () => {
    const alerts = harness();

    await alerts.pass([firing("spend_breaker"), firing("account_deletion_stuck")]);
    await alerts.pass([clear("spend_breaker"), firing("account_deletion_stuck")]);
    await alerts.pass([firing("spend_breaker"), firing("account_deletion_stuck")]);

    expect(alerts.sent).toEqual([
      { kind: "alert", condition: "spend_breaker" },
      { kind: "alert", condition: "account_deletion_stuck" },
      { kind: "recovery", condition: "spend_breaker" },
      { kind: "alert", condition: "spend_breaker" },
    ]);
    expect(alerts.episodes.filter((episode) => episode.condition === "spend_breaker")).toHaveLength(
      2,
    );
  });

  it("keeps an alert open when a pass cannot read its condition", async () => {
    const alerts = harness();

    await alerts.pass([firing("account_deletion_stuck")]);
    // The deletion sweep did not run this pass, so there is no reading at all.
    await alerts.pass([]);

    expect(alerts.sent).toEqual([{ kind: "alert", condition: "account_deletion_stuck" }]);
    expect(alerts.episodes[0]?.clearedAt).toBeNull();
  });

  it("does not raise the backlog alert while the Spend Breaker is shedding background work", async () => {
    const alerts = harness();

    await alerts.pass([firing("background_backlog")], "background");
    await alerts.pass([firing("background_backlog")], "interactive");

    expect(alerts.sent).toEqual([]);
    expect(alerts.episodes).toEqual([]);

    // Once the breaker closes, a backlog that is still there is a real one.
    await alerts.pass([firing("background_backlog")], "closed");
    expect(alerts.sent).toEqual([{ kind: "alert", condition: "background_backlog" }]);
  });

  it("holds an open backlog alert through shedding and still sends its recovery", async () => {
    const alerts = harness();

    await alerts.pass([firing("background_backlog")], "closed");
    await alerts.pass([firing("background_backlog")], "background");
    expect(alerts.episodes[0]?.clearedAt).toBeNull();

    await alerts.pass([clear("background_backlog")], "background");
    expect(alerts.sent).toEqual([
      { kind: "alert", condition: "background_backlog" },
      { kind: "recovery", condition: "background_backlog" },
    ]);
  });

  it("raises the backlog alert when the breaker's stage is unknown", async () => {
    const alerts = harness();

    await alerts.pass([firing("background_backlog")], null);

    expect(alerts.sent).toEqual([{ kind: "alert", condition: "background_backlog" }]);
  });

  it("quiets only the backlog: a Spend Breaker trip itself still alerts", async () => {
    const alerts = harness();

    await alerts.pass([firing("spend_breaker"), firing("stripe_reconciliation")], "interactive");

    expect(alerts.sent).toEqual([
      { kind: "alert", condition: "spend_breaker" },
      { kind: "alert", condition: "stripe_reconciliation" },
    ]);
  });

  it("retries a failed send on the next pass instead of losing or repeating it", async () => {
    const alerts = harness();

    alerts.failSends(true);
    const failed = await alerts.pass([firing("spend_breaker")]);
    expect(failed).toEqual({ sent: 0, failed: 1 });
    expect(alerts.errors).toEqual(["operator_alert.send_failed"]);

    alerts.failSends(false);
    await alerts.pass([firing("spend_breaker")]);
    await alerts.pass([firing("spend_breaker")]);

    expect(alerts.sent).toEqual([{ kind: "alert", condition: "spend_breaker" }]);
  });

  it("retries a failed recovery notice too", async () => {
    const alerts = harness();

    await alerts.pass([firing("spend_breaker")]);
    alerts.failSends(true);
    await alerts.pass([clear("spend_breaker")]);
    alerts.failSends(false);
    await alerts.pass([]);

    expect(alerts.sent).toEqual([
      { kind: "alert", condition: "spend_breaker" },
      { kind: "recovery", condition: "spend_breaker" },
    ]);
  });

  it("sends nothing for an episode that cleared before its alert could go out", async () => {
    const alerts = harness();

    alerts.failSends(true);
    await alerts.pass([firing("stripe_reconciliation")]);
    alerts.failSends(false);
    await alerts.pass([clear("stripe_reconciliation")]);

    expect(alerts.sent).toEqual([]);
  });
});
