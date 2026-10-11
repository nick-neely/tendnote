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

describe("First Value episode stability", () => {
  it("deduplicates sustained failure, holds unread samples, and reports alternating episodes", async () => {
    const alerts = harness();
    await alerts.pass([firing("first_value_path"), firing("grounded_eve_answer")]);
    await alerts.pass([firing("first_value_path")]);
    await alerts.pass([]);
    await alerts.pass([clear("first_value_path")]);
    await alerts.pass([firing("first_value_path")]);
    await alerts.pass([clear("first_value_path")]);
    expect(alerts.sent).toEqual([
      { kind: "alert", condition: "first_value_path" },
      { kind: "alert", condition: "grounded_eve_answer" },
      { kind: "recovery", condition: "first_value_path" },
      { kind: "alert", condition: "first_value_path" },
      { kind: "recovery", condition: "first_value_path" },
    ]);
    expect(
      alerts.episodes.find((e) => e.condition === "grounded_eve_answer")?.clearedAt,
    ).toBeNull();
  });

  it("claims one notice across concurrent passes and retains original sample dates on redelivery", async () => {
    const { store } = createInMemoryOperatorAlertStore();
    const openedAt = new Date("2026-10-11T17:50:00Z");
    const clearedAt = new Date("2026-10-11T18:00:00Z");
    const notices: unknown[] = [];
    const pass = (readings: OperatorAlertReading[], now: Date) =>
      runOperatorAlertPass({
        store,
        readings,
        now,
        breaker: null,
        notify: async (notice) => {
          notices.push(notice);
        },
      });
    await Promise.all([
      pass([firing("first_value_path")], openedAt),
      pass([firing("first_value_path")], openedAt),
    ]);
    expect(notices).toEqual([
      {
        condition: "first_value_path",
        kind: "alert",
        episodeId: "episode-1",
        openedAt,
        clearedAt: null,
      },
    ]);
    await pass([clear("first_value_path")], clearedAt);
    expect(notices[1]).toEqual({
      condition: "first_value_path",
      kind: "recovery",
      episodeId: "episode-1",
      openedAt,
      clearedAt,
    });
    expect(await store.claimNotices({ at: clearedAt })).toEqual([]);
    await store.releaseNotice({
      condition: "first_value_path",
      kind: "recovery",
      episodeId: "episode-1",
      openedAt,
      clearedAt,
    });
    expect(await store.claimNotices({ at: new Date(clearedAt.getTime() + 600_000) })).toEqual([
      notices[1],
    ]);
  });
});

it("attaches current evidence only to the episode this pass actually opened", async () => {
  const { store } = createInMemoryOperatorAlertStore();
  const at = new Date("2026-10-11T17:50:00Z");
  // Another concurrent pass won the insert, even with the identical timestamp.
  await store.open({ condition: "first_value_path", at });
  const matches: boolean[] = [];
  await runOperatorAlertPass({
    store,
    readings: [firing("first_value_path")],
    breaker: null,
    now: at,
    notify: async (_notice, observedInThisPass) => {
      matches.push(observedInThisPass);
    },
  });
  expect(matches).toEqual([false]);
  await runOperatorAlertPass({
    store,
    readings: [clear("first_value_path")],
    breaker: null,
    notify: async () => {},
    now: new Date(at.getTime() + 600_000),
  });
  await runOperatorAlertPass({
    store,
    readings: [firing("first_value_path")],
    breaker: null,
    notify: async (_notice, observedInThisPass) => {
      matches.push(observedInThisPass);
    },
    now: new Date(at.getTime() + 1_200_000),
  });
  expect(matches).toEqual([false, true]);
});
