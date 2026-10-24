import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryOperatorAlertStore } from "../../../../../packages/db/src/queries/operator-alerts/in-memory-store";
import type { FirstValueCheck } from "../first-value-check";
import type { OperatorAlertMessage } from "./channel";
import { runOperatorAlerts } from "./pass";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  createStore: vi.fn(),
  send: vi.fn<(message: OperatorAlertMessage) => Promise<void>>(),
}));
vi.mock("@tendnote/db/queries/operator-alerts", async (original) => ({
  ...(await original<typeof import("@tendnote/db/queries/operator-alerts")>()),
  createDrizzleOperatorAlertStore: mocks.createStore,
}));
vi.mock("@tendnote/db/queries/account-deletion", () => ({
  hasStuckAccountDeletionIntent: async () => false,
}));
vi.mock("@tendnote/db/queries/reliability-indicators", () => ({
  hasBackgroundBacklog: async () => false,
  hasLateReminderDelivery: async () => false,
}));
vi.mock("@tendnote/db/queries/spend-breaker", () => ({
  readSpendBreakerStage: async () => "closed",
}));
vi.mock("@/lib/backup-surfaces", () => ({ backupSurfaceReading: async () => ({ status: "off" }) }));
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

describe("cron First Value alert wiring", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const memory = createInMemoryOperatorAlertStore();
    mocks.createStore.mockImplementation(
      () => createInMemoryOperatorAlertStore(memory.state).store,
    );
    mocks.send.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  async function sample(slot: number, value: FirstValueCheck | null) {
    vi.setSystemTime(new Date(Date.parse("2026-10-23T20:00:00Z") + slot * 600_000));
    mocks.check.mockResolvedValue(value);
    await runOperatorAlerts({ stripeReconciliation: { status: "skipped" } });
  }

  it("classifies, deduplicates, confirms and recovers through the real alert service", async () => {
    await sample(0, check("failed"));
    await sample(0, check("failed"));
    expect(mocks.send).not.toHaveBeenCalled();
    await sample(1, check("failed"));
    await sample(2, check("retried"));
    await sample(3, null);
    await sample(4, check("clean"));
    expect(mocks.send).toHaveBeenCalledTimes(1);
    await sample(5, check("clean"));
    const messages = mocks.send.mock.calls.map(([message]) => message);
    expect(messages.map((message) => message.title)).toEqual([
      "First Value path check failing",
      "First Value path check passing",
    ]);
    expect(messages[0]?.body).toContain("transient model failures: 2");
  });

  it("keeps the daily grounded-answer episode independent of model confirmation", async () => {
    await sample(0, check("failed", false));
    expect(mocks.send.mock.calls[0]?.[0].title).toBe("Synthetic Eve answer failing");
    await sample(1, check("clean"));
    expect(mocks.send).toHaveBeenCalledTimes(1);
    await sample(2, check("clean", true));
    expect(mocks.send.mock.calls[1]?.[0].title).toBe("Synthetic Eve answer passing");
  });
});
