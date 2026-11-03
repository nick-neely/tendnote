import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryOperatorAlertStore } from "../../../../../packages/db/src/queries/operator-alerts/in-memory-store";
import type { FirstValueCheck } from "../first-value-check";
import type { OperatorAlertMessage } from "./channel";
import { runOperatorAlerts } from "./pass";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  readings: {
    backlog: false,
    deletionStuck: false,
    remindersLate: false,
    breakerOpen: false,
    backupFinding: false,
    stripeFailed: false,
  },
  createStore: vi.fn(),
  send: vi.fn<(message: OperatorAlertMessage) => Promise<void>>(),
}));
vi.mock("@tendnote/db/queries/operator-alerts", async (original) => ({
  ...(await original<typeof import("@tendnote/db/queries/operator-alerts")>()),
  createDrizzleOperatorAlertStore: mocks.createStore,
}));
vi.mock("@tendnote/db/queries/account-deletion", () => ({
  hasStuckAccountDeletionIntent: async () => mocks.readings.deletionStuck,
}));
vi.mock("@tendnote/db/queries/reliability-indicators", () => ({
  hasBackgroundBacklog: async () => mocks.readings.backlog,
  hasLateReminderDelivery: async () => mocks.readings.remindersLate,
}));
vi.mock("@tendnote/db/queries/spend-breaker", () => ({
  readSpendBreakerStage: async () => (mocks.readings.breakerOpen ? "interactive" : "closed"),
}));
vi.mock("@/lib/backup-surfaces", () => ({
  backupSurfaceReading: async () => ({
    status: "ran",
    findings: mocks.readings.backupFinding
      ? [{ surface: "snapshot", id: "snap-one", name: "fixture" }]
      : [],
  }),
}));
vi.mock("@/lib/first-value-check", () => ({
  checkFirstValuePath: mocks.check,
  claimDailyGroundedAnswer: async () => false,
}));
vi.mock("./channel", () => ({
  operatorAlertDestinations: () => ({ email: "operator@example.test", push: null }),
  createOperatorAlertSender: () => mocks.send,
}));

function check(
  kind: "failed" | "retried" | "clean",
  groundedAnswer: boolean | null = null,
): FirstValueCheck {
  const deadline = { outcome: "deadline", elapsedMs: 15_000, phase: "gateway" } as const;
  const passed = { outcome: "passed", elapsedMs: 1_500, phase: "complete" } as const;
  return {
    status: "ran",
    failed: kind === "failed" ? ["model"] : [],
    groundedAnswer,
    model: {
      passed: kind !== "failed",
      elapsedMs: 32_000,
      attempts:
        kind === "failed"
          ? [deadline, deadline]
          : kind === "retried"
            ? [deadline, passed]
            : [passed],
    },
  };
}

const TEN_MINUTE = { firstValuePolicy: "ten_minute" } as const;
const DAILY = { firstValuePolicy: "daily" } as const;
let memory: ReturnType<typeof createInMemoryOperatorAlertStore>;

/** Every cron pass builds a fresh store over the same persisted state. */
function useStore(options: typeof TEN_MINUTE | typeof DAILY) {
  memory = createInMemoryOperatorAlertStore(undefined, options);
  mocks.createStore.mockImplementation(
    () => createInMemoryOperatorAlertStore(memory.state, options).store,
  );
}

const start = Date.parse("2026-10-23T20:00:00Z");

/** One cron pass at `slot` ten-minute slots after `start`; the check honours its run claim. */
async function pass(slot: number, value: FirstValueCheck | null) {
  vi.setSystemTime(new Date(start + slot * 600_000));
  mocks.check.mockImplementation(async (input: { claimRun?: () => Promise<boolean> }) => {
    if (input.claimRun && !(await input.claimRun())) return { status: "skipped" };
    return value;
  });
  return runOperatorAlerts({
    stripeReconciliation: {
      status: "ran",
      scanned: 0,
      admitted: 0,
      dunningClosed: 0,
      revoked: 0,
      unknownCustomer: 0,
      failed: mocks.readings.stripeFailed ? 1 : 0,
      unmatchedRefunds: 0,
    },
  });
}

const titles = () => mocks.send.mock.calls.map(([message]) => message.title);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  mocks.send.mockReset().mockResolvedValue(undefined);
  mocks.check.mockReset();
  setAllConditions(false);
});

/**
 * Every non-synthetic condition the alert pass reads, firing or clear together.
 * The Spend Breaker is left to its own passes: a tripped breaker deliberately
 * quiets the backlog alert.
 */
function setAllConditions(firing: boolean) {
  for (const key of Object.keys(mocks.readings) as (keyof typeof mocks.readings)[]) {
    if (key !== "breakerOpen") mocks.readings[key] = firing;
  }
}
afterEach(() => vi.useRealTimers());

describe("cron First Value alert wiring (ten-minute policy)", () => {
  beforeEach(() => useStore(TEN_MINUTE));

  it("classifies, deduplicates, confirms and recovers through the real alert service", async () => {
    await pass(0, check("failed"));
    await pass(0, check("failed"));
    expect(mocks.send).not.toHaveBeenCalled();
    await pass(1, check("failed"));
    await pass(2, check("retried"));
    await pass(3, null);
    await pass(4, check("clean"));
    expect(mocks.send).toHaveBeenCalledTimes(1);
    await pass(5, check("clean"));
    expect(titles()).toEqual(["First Value path check failing", "First Value path check passing"]);
    expect(mocks.send.mock.calls[0]?.[0].body).toContain("transient model failures: 2");
  });

  it("keeps the daily grounded-answer episode independent of model confirmation", async () => {
    await pass(0, check("failed", false));
    expect(titles()).toEqual(["Synthetic Eve answer failing"]);
    await pass(1, check("clean"));
    expect(mocks.send).toHaveBeenCalledTimes(1);
    await pass(2, check("clean", true));
    expect(titles()[1]).toBe("Synthetic Eve answer passing");
  });
});

describe("cron First Value alert wiring (prelaunch daily policy)", () => {
  beforeEach(() => useStore(DAILY));
  /** Slot 0 is 20:00 UTC; slot -36 is 14:00, before the daily hour. */
  const dayLater = 144;

  it("runs the check on one pass a day and gives the others no sample", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await pass(-36, check("clean"));
    for (let slot = 0; slot < 24; slot += 1) await pass(slot, check("clean"));
    await pass(dayLater, check("clean"));
    expect(mocks.check).toHaveBeenCalledTimes(26);
    expect(memory.state.firstValue.daily).toMatchObject({ runs: 1, settled: true });
    // 26 cron passes, two of them claimed: one per UTC day at or after 15:00.
    const claimed = await Promise.all(
      mocks.check.mock.results.map(async (result) => (await result.value) as FirstValueCheck),
    );
    expect(claimed.filter((value) => value.status === "ran")).toHaveLength(2);
    expect(mocks.send).not.toHaveBeenCalled();
    // The check count in the logs counts runs, not cron passes or a check that is off.
    await pass(dayLater + 144, { status: "off" });
    const sampled = info.mock.calls.filter(([message]) => message === "first_value_check.sampled");
    expect(sampled).toEqual([
      ["first_value_check.sampled", { policy: "daily", outcome: "clean" }],
      ["first_value_check.sampled", { policy: "daily", outcome: "clean" }],
    ]);
    info.mockRestore();
  });

  it("holds an open incident until a genuine clean daily check, never at transition", async () => {
    await memory.store.open({ condition: "first_value_path", at: new Date(start - 600_000) });
    await pass(0, check("retried"));
    await pass(1, check("clean"));
    expect(titles()).toEqual(["First Value path check failing"]);
    await pass(dayLater, check("clean"));
    expect(titles()).toEqual(["First Value path check failing", "First Value path check passing"]);
  });

  it("confirms a transient model failure on the next pass, not the next day", async () => {
    await pass(0, check("failed"));
    expect(mocks.send).not.toHaveBeenCalled();
    await pass(1, check("failed"));
    expect(titles()).toEqual(["First Value path check failing"]);
    expect(mocks.send.mock.calls[0]?.[0].body).toContain("transient model failures: 2");
  });

  it("keeps every other operator condition on every pass while the check is skipped", async () => {
    await pass(0, check("clean"));
    setAllConditions(true);
    await pass(1, check("clean"));
    expect(await mocks.check.mock.results[1]?.value).toEqual({ status: "skipped" });
    expect(titles().sort()).toEqual([
      "Account deletion stuck over 24 hours",
      "Background delivery backlog over thirty minutes",
      "Backup surface does not match the Backup Window",
      "Reminders delivering late",
      "Stripe reconciliation failing",
    ]);
    setAllConditions(false);
    await pass(2, check("clean"));
    expect(await mocks.check.mock.results[2]?.value).toEqual({ status: "skipped" });
    expect(titles().slice(5).sort()).toEqual([
      "Background delivery backlog cleared",
      "Backup surfaces match the Backup Window again",
      "Reminder delivery back on time",
      "Stripe reconciliation recovered",
      "Stuck account deletions completed",
    ]);
    mocks.readings.breakerOpen = true;
    await pass(3, check("clean"));
    mocks.readings.breakerOpen = false;
    await pass(4, check("clean"));
    expect(titles().slice(10)).toEqual(["Spend Breaker tripped", "Spend Breaker closed"]);
    expect(mocks.check.mock.results).toHaveLength(5);
    expect(memory.state.firstValue.daily).toMatchObject({ runs: 1 });
  });
});
