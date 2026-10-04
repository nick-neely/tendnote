import { HouseholdValidationError, lapsedRetentionDeadline } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryAccountRetentionStore } from "./in-memory-store";
import { type AccountRetentionDependencies, runAccountRetentionSweep } from "./service";

const DAY = 24 * 60 * 60 * 1000;
const lapsedAt = new Date("2026-01-01T12:00:00.000Z");
const deadline = lapsedRetentionDeadline(lapsedAt);
const day = (n: number) => new Date(lapsedAt.getTime() + n * DAY);

function harness() {
  const store = createInMemoryAccountRetentionStore();
  const sendNotice = vi.fn<AccountRetentionDependencies["sendNotice"]>(async () => {});
  const purge = vi.fn<AccountRetentionDependencies["purge"]>(async () => ({ status: "deleted" }));
  const assertDeletionAllowed = vi.fn<AccountRetentionDependencies["assertDeletionAllowed"]>(
    async () => {},
  );
  const logger = { info: vi.fn(), error: vi.fn() };
  store.hold({
    userId: "user_1",
    email: "user_1@example.test",
    kind: "lapsed",
    retentionDeadline: deadline,
  });
  const sweep = (now: Date) =>
    runAccountRetentionSweep({
      store,
      sendNotice,
      purge,
      assertDeletionAllowed,
      logger,
      limit: 10,
      now,
    });
  return { store, sendNotice, purge, assertDeletionAllowed, logger, sweep };
}

const stagesSent = (sendNotice: ReturnType<typeof harness>["sendNotice"]) =>
  sendNotice.mock.calls.map(([notice]) => notice.stage);

describe("runAccountRetentionSweep", () => {
  it("sends the notices on days 0, 60, and 83, once each, then purges at the deadline", async () => {
    const { sendNotice, purge, sweep } = harness();

    for (const n of [0, 1, 59, 60, 61, 82, 83, 84, 89]) await sweep(day(n));
    expect(stagesSent(sendNotice)).toEqual(["day_0", "day_60", "day_83"]);
    expect(sendNotice.mock.calls[0]?.[0]).toEqual({
      to: "user_1@example.test",
      userId: "user_1",
      kind: "lapsed",
      stage: "day_0",
      retentionDeadline: deadline,
    });
    expect(purge).not.toHaveBeenCalled();

    const result = await sweep(day(90));

    expect(result).toMatchObject({ scanned: 1, purged: 1, notified: 0 });
    expect(purge).toHaveBeenCalledWith({ userId: "user_1", now: day(90) });
    expect(await sweep(day(91))).toMatchObject({ scanned: 0 });
  });

  it("stops the sequence when the account resubscribes", async () => {
    const { store, sendNotice, purge, sweep } = harness();
    await sweep(day(0));

    store.resubscribe("user_1");
    for (const n of [60, 83, 90]) await sweep(day(n));

    expect(stagesSent(sendNotice)).toEqual(["day_0"]);
    expect(purge).not.toHaveBeenCalled();
  });

  it("starts a fresh sequence when a resubscribed account lapses again", async () => {
    const { store, sendNotice, sweep } = harness();
    for (const n of [0, 60]) await sweep(day(n));
    store.resubscribe("user_1");

    const relapsedAt = day(70);
    store.hold({
      userId: "user_1",
      email: "user_1@example.test",
      kind: "lapsed",
      retentionDeadline: lapsedRetentionDeadline(relapsedAt),
    });
    await sweep(relapsedAt);

    expect(stagesSent(sendNotice)).toEqual(["day_0", "day_60", "day_0"]);
  });

  it("never purges an account that resubscribed after it was listed", async () => {
    const { store, purge, sweep } = harness();
    const listDue = store.listDue;
    store.listDue = async (input) => {
      const due = await listDue(input);
      store.resubscribe("user_1");
      return due;
    };

    await sweep(day(90));

    expect(purge).not.toHaveBeenCalled();
    expect(store.hasIntent("user_1")).toBe(false);
  });

  it("pauses the notices under a Legal Hold, then resumes from the stage reached (#632)", async () => {
    const { store, sendNotice, purge, sweep } = harness();
    await sweep(day(0));
    store.placeLegalHold("user_1", day(70));

    for (const n of [60, 65, 69]) await sweep(day(n));
    expect(stagesSent(sendNotice)).toEqual(["day_0"]);

    for (const n of [70, 83, 90]) await sweep(day(n));
    expect(stagesSent(sendNotice)).toEqual(["day_0", "day_60", "day_83"]);
    expect(purge).toHaveBeenCalledWith({ userId: "user_1", now: day(90) });
  });

  it("never purges a held account past its deadline, and purges it once the hold ends (#632)", async () => {
    const { store, purge, sweep } = harness();
    for (const n of [0, 60, 83]) await sweep(day(n));
    store.placeLegalHold("user_1", day(120));

    for (const n of [90, 100, 119]) {
      expect(await sweep(day(n))).toMatchObject({ scanned: 0 });
    }
    expect(purge).not.toHaveBeenCalled();
    expect(store.hasIntent("user_1")).toBe(false);

    expect(await sweep(day(120))).toMatchObject({ scanned: 1, purged: 1 });
  });

  it("carries on for an account the hold does not name (#632)", async () => {
    const { store, sendNotice, purge, sweep } = harness();
    store.hold({
      userId: "user_2",
      email: "user_2@example.test",
      kind: "lapsed",
      retentionDeadline: deadline,
    });
    store.placeLegalHold("user_1", day(365));

    for (const n of [0, 60, 83, 90]) await sweep(day(n));

    expect(sendNotice.mock.calls.map(([notice]) => notice.userId)).toEqual([
      "user_2",
      "user_2",
      "user_2",
    ]);
    expect(purge.mock.calls).toEqual([[{ userId: "user_2", now: day(90) }]]);
  });

  it("never purges an account held after it was listed (#632)", async () => {
    const { store, purge, sweep } = harness();
    const listDue = store.listDue;
    store.listDue = async (input) => {
      const due = await listDue(input);
      store.placeLegalHold("user_1", day(120));
      return due;
    };

    await sweep(day(90));

    expect(purge).not.toHaveBeenCalled();
    expect(store.hasIntent("user_1")).toBe(false);
  });

  it("resends a notice whose record failed, so the next pass collapses it by key", async () => {
    const { store, sendNotice, sweep } = harness();
    const recordNotice = store.recordNotice;
    store.recordNotice = vi.fn().mockRejectedValueOnce(new Error("db down"));

    expect(await sweep(day(0))).toMatchObject({ failed: 1, notified: 0 });
    store.recordNotice = recordNotice;
    expect(await sweep(day(0))).toMatchObject({ notified: 1 });

    expect(stagesSent(sendNotice)).toEqual(["day_0", "day_0"]);
  });

  it("records nothing when the send fails, and retries on the next pass", async () => {
    const { sendNotice, sweep } = harness();
    sendNotice.mockRejectedValueOnce(new Error("resend down"));

    expect(await sweep(day(0))).toMatchObject({ failed: 1 });
    expect(await sweep(day(0))).toMatchObject({ notified: 1 });
  });

  it("alerts and keeps the account when the household guard refuses its purge", async () => {
    const { store, purge, assertDeletionAllowed, logger, sweep } = harness();
    assertDeletionAllowed.mockRejectedValue(new HouseholdValidationError("sole owner"));

    const result = await sweep(day(90));

    expect(result).toMatchObject({ refused: 1, purged: 0, failed: 0 });
    expect(purge).not.toHaveBeenCalled();
    expect(store.hasIntent("user_1")).toBe(false);
    expect(logger.error).toHaveBeenCalledWith("account_retention.purge_refused", {
      userId: "user_1",
    });
  });

  it("gives a terminated account the same schedule under its own kind", async () => {
    const { store, sendNotice, purge, sweep } = harness();
    store.resubscribe("user_1");
    store.hold({
      userId: "user_2",
      email: "user_2@example.test",
      kind: "terminated",
      retentionDeadline: deadline,
    });

    for (const n of [0, 60, 83, 90]) await sweep(day(n));

    expect(sendNotice.mock.calls.map(([notice]) => [notice.kind, notice.stage])).toEqual([
      ["terminated", "day_0"],
      ["terminated", "day_60"],
      ["terminated", "day_83"],
    ]);
    expect(purge).toHaveBeenCalledWith({ userId: "user_2", now: day(90) });
  });

  it("counts a purge the recovery sweep must finish as deferred, not purged", async () => {
    const { purge, sweep } = harness();
    purge.mockResolvedValueOnce({ status: "pending" });

    expect(await sweep(day(90))).toMatchObject({ purged: 0, deferred: 1 });
  });

  it("moves a refused account behind the rest, so it never holds the pass's budget", async () => {
    const { store, sendNotice, assertDeletionAllowed, logger } = harness();
    assertDeletionAllowed.mockRejectedValue(new HouseholdValidationError("sole owner"));
    store.hold({
      userId: "user_2",
      email: "user_2@example.test",
      kind: "lapsed",
      retentionDeadline: day(150),
    });
    const sweepOne = (now: Date) =>
      runAccountRetentionSweep({
        store,
        sendNotice,
        purge: async () => ({ status: "deleted" }),
        assertDeletionAllowed,
        logger,
        limit: 1,
        now,
      });

    await sweepOne(day(90));
    await sweepOne(day(90));

    expect(stagesSent(sendNotice)).toEqual(["day_0"]);
    expect(sendNotice.mock.calls[0]?.[0].userId).toBe("user_2");
  });

  it("does nothing without budget", async () => {
    const { store, sendNotice, purge, assertDeletionAllowed } = harness();

    const result = await runAccountRetentionSweep({
      store,
      sendNotice,
      purge,
      assertDeletionAllowed,
      limit: 0,
      now: day(0),
    });

    expect(result).toEqual({
      scanned: 0,
      notified: 0,
      purged: 0,
      deferred: 0,
      refused: 0,
      failed: 0,
    });
    expect(sendNotice).not.toHaveBeenCalled();
  });
});
