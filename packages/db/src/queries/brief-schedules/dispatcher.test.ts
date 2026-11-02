import { type CreateBriefScheduleInput, computeNextBriefRun } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { createBriefScheduleDispatcher, type ScheduledBriefGenerator } from "./dispatcher";
import { createInMemoryBriefScheduleStore } from "./in-memory-store";

const OWNER = "user-1";
const OTHER_OWNER = "user-2";

type GenerateCall = { ownerUserId: string; cadence: string; localDate: string };

function dailyRow(overrides: Partial<CreateBriefScheduleInput> = {}): CreateBriefScheduleInput {
  return {
    ownerUserId: OWNER,
    cadence: "daily",
    timezone: "UTC",
    runAtMinute: 8 * 60,
    weekday: null,
    nextRunAt: new Date("2026-06-27T08:00:00Z"),
    enabled: true,
    leaseExpiresAt: null,
    attempts: 0,
    lastError: null,
    lastRunAt: null,
    ...overrides,
  };
}

function setup(generate: ScheduledBriefGenerator) {
  const store = createInMemoryBriefScheduleStore();
  const dispatcher = createBriefScheduleDispatcher(store, generate);
  return { store, dispatcher };
}

function recordingGenerator() {
  const calls: GenerateCall[] = [];
  const generate: ScheduledBriefGenerator = async (input) => {
    calls.push({
      ownerUserId: input.ownerUserId,
      cadence: input.cadence,
      localDate: input.localDate,
    });
  };
  return { calls, generate };
}

const NOW = new Date("2026-06-27T09:00:00Z");

describe("brief schedule dispatcher", () => {
  it("claims a due row, generates its brief, and advances the next run", async () => {
    const { calls, generate } = recordingGenerator();
    const { store, dispatcher } = setup(generate);
    const created = await store.createBriefSchedule(dailyRow());

    const result = await dispatcher.runDueBriefSchedules({ now: NOW });

    expect(result).toEqual({ claimed: 1, generated: 1, skipped: 0, failed: 0 });
    expect(calls).toEqual([{ ownerUserId: OWNER, cadence: "daily", localDate: "2026-06-27" }]);

    const after = await store.getBriefScheduleForOwner({ ownerUserId: OWNER, cadence: "daily" });
    expect(after?.leaseExpiresAt).toBeNull();
    expect(after?.attempts).toBe(0);
    expect(after?.lastRunAt?.toISOString()).toBe(NOW.toISOString());
    expect(after?.nextRunAt.toISOString()).toBe(computeNextBriefRun(created, NOW).toISOString());
  });

  it("does not claim future or disabled rows", async () => {
    const { calls, generate } = recordingGenerator();
    const { store, dispatcher } = setup(generate);
    await store.createBriefSchedule(dailyRow({ nextRunAt: new Date("2026-07-01T08:00:00Z") }));
    await store.createBriefSchedule(dailyRow({ cadence: "weekly", weekday: 1, enabled: false }));

    const result = await dispatcher.runDueBriefSchedules({ now: NOW });
    expect(result.claimed).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("does not let an overlapping tick re-claim a leased row", async () => {
    const { store } = setup(async () => {});
    await store.createBriefSchedule(dailyRow());

    const first = await store.claimDueBriefSchedules({ now: NOW, leaseMs: 60_000 });
    expect(first).toHaveLength(1);

    // A second tick within the lease window claims nothing.
    const overlapping = await store.claimDueBriefSchedules({
      now: new Date(NOW.getTime() + 30_000),
      leaseMs: 60_000,
    });
    expect(overlapping).toHaveLength(0);

    // Once the lease expires the row is claimable again (at-least-once retry).
    const afterExpiry = await store.claimDueBriefSchedules({
      now: new Date(NOW.getTime() + 90_000),
      leaseMs: 60_000,
    });
    expect(afterExpiry).toHaveLength(1);
  });

  it("does not regenerate on a duplicate tick once the run has advanced", async () => {
    const { calls, generate } = recordingGenerator();
    const { store, dispatcher } = setup(generate);
    await store.createBriefSchedule(dailyRow());

    await dispatcher.runDueBriefSchedules({ now: NOW });
    await dispatcher.runDueBriefSchedules({ now: NOW });

    // The row advanced to its next run after the first tick, so the second tick
    // finds nothing due — no duplicate generation.
    expect(calls).toHaveLength(1);
  });

  it("retries a failed generation, then gives up past maxAttempts and rolls forward", async () => {
    let failures = 0;
    const generate: ScheduledBriefGenerator = async () => {
      failures += 1;
      throw new Error("generation boom");
    };
    const { store, dispatcher } = setup(generate);
    const created = await store.createBriefSchedule(dailyRow());

    // Each tick claims (attempts++), fails, and releases. With maxAttempts=2 the
    // first tick (attempts=1) retries — the row stays due — and the second tick
    // (attempts=2 >= 2) gives up the occurrence and rolls forward.
    await dispatcher.runDueBriefSchedules({ now: NOW, maxAttempts: 2 });
    let row = await store.getBriefScheduleForOwner({ ownerUserId: OWNER, cadence: "daily" });
    expect(row?.lastError).toBe("generation boom");
    expect(row?.attempts).toBe(1);
    expect(row?.nextRunAt.toISOString()).toBe(created.nextRunAt.toISOString()); // still due

    await dispatcher.runDueBriefSchedules({ now: NOW, maxAttempts: 2 });
    row = await store.getBriefScheduleForOwner({ ownerUserId: OWNER, cadence: "daily" });

    expect(failures).toBe(2);
    expect(row?.attempts).toBe(0);
    expect(row?.nextRunAt.toISOString()).toBe(computeNextBriefRun(created, NOW).toISOString());

    // The rolled-forward run is in the future, so a later tick finds nothing due.
    await dispatcher.runDueBriefSchedules({ now: NOW, maxAttempts: 2 });
    expect(failures).toBe(2);
  });

  it("derives the brief's local date from the row's timezone", async () => {
    const { calls, generate } = recordingGenerator();
    const { store, dispatcher } = setup(generate);
    // 06:00 UTC is still 2026-06-27 evening in Los Angeles.
    await store.createBriefSchedule(
      dailyRow({ timezone: "America/Los_Angeles", nextRunAt: new Date("2026-06-28T06:00:00Z") }),
    );

    await dispatcher.runDueBriefSchedules({ now: new Date("2026-06-28T07:00:00Z") });
    expect(calls[0]?.localDate).toBe("2026-06-27");
  });

  it("holds failed runs across faster and duplicate ticks, retaining five attempts over at least an hour", async () => {
    const generate = vi.fn<ScheduledBriefGenerator>().mockRejectedValue(new Error("offline"));
    const { store } = setup(generate);
    const created = await store.createBriefSchedule(dailyRow({ nextRunAt: NOW }));
    const minute = (value: number) => new Date(NOW.getTime() + value * 60_000);

    for (let elapsed = 0; elapsed <= 80; elapsed += 10) {
      // Recreating the dispatcher proves that retry state survives an invocation.
      const dispatcher = createBriefScheduleDispatcher(store, generate);
      await dispatcher.runDueBriefSchedules({ now: minute(elapsed), retryDelayMs: 900_000 });
      await dispatcher.runDueBriefSchedules({ now: minute(elapsed), retryDelayMs: 900_000 });
      expect(generate).toHaveBeenCalledTimes(Math.floor(elapsed / 20) + 1);
      if (elapsed < 80) {
        const row = await store.getBriefScheduleForOwner({ ownerUserId: OWNER, cadence: "daily" });
        expect(row?.nextRunAt).toEqual(created.nextRunAt);
      }
    }

    expect(generate.mock.calls.map(([input]) => input.now)).toEqual(
      [0, 20, 40, 60, 80].map(minute),
    );
    const row = await store.getBriefScheduleForOwner({ ownerUserId: OWNER, cadence: "daily" });
    expect(row?.leaseExpiresAt).toBeNull();
    expect(row?.attempts).toBe(0);
    expect(row?.nextRunAt).toEqual(computeNextBriefRun(created, minute(80)));
  });

  it("clears the retry hold on success without changing the scheduled local date", async () => {
    const generate = vi
      .fn<ScheduledBriefGenerator>()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue(undefined);
    const { store, dispatcher } = setup(generate);
    await store.createBriefSchedule(dailyRow());
    await dispatcher.runDueBriefSchedules({ now: NOW, retryDelayMs: 900_000 });
    const later = new Date(NOW.getTime() + 20 * 60_000);
    await dispatcher.runDueBriefSchedules({ now: later, retryDelayMs: 900_000 });
    expect(generate.mock.calls.map(([input]) => input.localDate)).toEqual([
      "2026-06-27",
      "2026-06-27",
    ]);
    const row = await store.getBriefScheduleForOwner({ ownerUserId: OWNER, cadence: "daily" });
    expect(row).toMatchObject({
      attempts: 0,
      lastError: null,
      leaseExpiresAt: null,
      lastRunAt: later,
    });
  });

  it("starts a later row's retry hold at its own attempt, not at batch claim time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const generate = vi
      .fn<ScheduledBriefGenerator>()
      .mockImplementation(async ({ ownerUserId }) => {
        if (ownerUserId === OWNER) {
          vi.setSystemTime(new Date(NOW.getTime() + 2 * 60_000));
          return;
        }
        throw new Error("later owner's failure");
      });
    const { store, dispatcher } = setup(generate);
    await store.createBriefSchedule(dailyRow());
    await store.createBriefSchedule(dailyRow({ ownerUserId: OTHER_OWNER }));
    try {
      await dispatcher.runDueBriefSchedules({ retryDelayMs: 900_000 });
      const row = await store.getBriefScheduleForOwner({
        ownerUserId: OTHER_OWNER,
        cadence: "daily",
      });
      expect(row?.leaseExpiresAt).toEqual(new Date(NOW.getTime() + 17 * 60_000));
      vi.setSystemTime(new Date(NOW.getTime() + 16 * 60_000));
      await dispatcher.runDueBriefSchedules({ retryDelayMs: 900_000 });
      expect(generate).toHaveBeenCalledTimes(2);
      vi.setSystemTime(new Date(NOW.getTime() + 17 * 60_000));
      await dispatcher.runDueBriefSchedules({ retryDelayMs: 900_000 });
      expect(generate).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets healthy owners run when another owner's generation fails and retries are held", async () => {
    const generate = vi
      .fn<ScheduledBriefGenerator>()
      .mockImplementation(async ({ ownerUserId }) => {
        if (ownerUserId === OWNER) throw new Error("owner-specific failure");
      });
    const { store, dispatcher } = setup(generate);
    await store.createBriefSchedule(dailyRow());
    await store.createBriefSchedule(dailyRow({ ownerUserId: OTHER_OWNER }));
    expect(await dispatcher.runDueBriefSchedules({ now: NOW, retryDelayMs: 900_000 })).toEqual({
      claimed: 2,
      generated: 1,
      skipped: 0,
      failed: 1,
    });
  });

  it("generates each owner's brief under their own scope", async () => {
    const { calls, generate } = recordingGenerator();
    const { store, dispatcher } = setup(generate);
    await store.createBriefSchedule(dailyRow());
    await store.createBriefSchedule(dailyRow({ ownerUserId: OTHER_OWNER }));

    await dispatcher.runDueBriefSchedules({ now: NOW });

    expect(calls.map((call) => call.ownerUserId).sort()).toEqual([OWNER, OTHER_OWNER].sort());
  });

  it("skips the occurrence for an owner whose background work is paused, and rolls forward", async () => {
    const { calls, generate } = recordingGenerator();
    const { store, dispatcher } = setup(generate);
    const created = await store.createBriefSchedule(dailyRow());
    await store.createBriefSchedule(dailyRow({ ownerUserId: OTHER_OWNER }));

    const result = await dispatcher.runDueBriefSchedules({
      now: NOW,
      skipOwner: async (ownerUserId) => ownerUserId === OWNER,
    });

    expect(result).toEqual({ claimed: 2, generated: 1, skipped: 1, failed: 0 });
    expect(calls.map((call) => call.ownerUserId)).toEqual([OTHER_OWNER]);
    const after = await store.getBriefScheduleForOwner({ ownerUserId: OWNER, cadence: "daily" });
    // The next delivery is skipped, not retried: the row moves on to its next run and
    // keeps the last run it actually had.
    expect(after?.nextRunAt.toISOString()).toBe(computeNextBriefRun(created, NOW).toISOString());
    expect(after?.lastRunAt).toBeNull();
    expect(after?.leaseExpiresAt).toBeNull();
    expect(after?.attempts).toBe(0);
  });
});
