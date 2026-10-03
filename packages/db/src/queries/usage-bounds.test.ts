import { beforeEach, describe, expect, it, vi } from "vitest";

/** What the fake database answers: the profile read first, then the ledger sums per category. */
const db = vi.hoisted(() => ({
  reads: [] as unknown[][],
  updated: [] as unknown[],
}));

vi.mock("../client", () => {
  const read = () => {
    const rows = db.reads.shift() ?? [];
    const query = {
      from: () => query,
      where: () => query,
      groupBy: () => query,
      limit: async () => rows,
      // biome-ignore lint/suspicious/noThenProperty: a drizzle query is awaited directly.
      then: (resolve: (value: unknown[]) => unknown) => resolve(rows),
    };
    return query;
  };
  return {
    getDb: () => ({
      select: read,
      update: () => ({
        set: () => ({ where: () => ({ returning: async () => db.updated }) }),
      }),
    }),
  };
});

const breaker = vi.hoisted(() => ({ stage: "closed" as string, fails: false }));

vi.mock("./spend-breaker", () => ({
  readSpendBreakerStage: async () => {
    if (breaker.fails) throw new Error("spend_breaker_days unavailable");
    return breaker.stage;
  },
}));

import {
  anchorUsagePeriod,
  readEveOverFairUseBudget,
  readEveUsageNotice,
  readUsageNotices,
} from "./usage-bounds";

const now = new Date("2026-10-20T12:00:00Z");

beforeEach(() => {
  db.reads = [];
  db.updated = [];
  breaker.stage = "closed";
  breaker.fails = false;
});

describe("readEveUsageNotice", () => {
  it("is normal for an account with no subscription anchor, without reading the ledger", async () => {
    db.reads = [[{ anchor: null }], [{ costCategory: "interactive", microUsd: "99000000" }]];

    await expect(readEveUsageNotice({ userId: "owner-1", now })).resolves.toEqual({
      state: "normal",
    });
    expect(db.reads).toHaveLength(1);
  });

  it("is normal for an account with no Access Profile", async () => {
    db.reads = [[]];

    await expect(readEveUsageNotice({ userId: "owner-1", now })).resolves.toEqual({
      state: "normal",
    });
  });

  it("is normal below the plan's interactive Fair-Use Budget", async () => {
    db.reads = [
      [{ anchor: "2026-03-15" }],
      [{ costCategory: "interactive", microUsd: "10499999" }],
    ];

    await expect(readEveUsageNotice({ userId: "owner-1", now })).resolves.toEqual({
      state: "normal",
    });
  });

  it("is reduced from the Fair-Use Budget until the anchored Usage Period resets", async () => {
    db.reads = [
      [{ anchor: "2026-03-15" }],
      [{ costCategory: "interactive", microUsd: "11999999" }],
    ];

    await expect(readEveUsageNotice({ userId: "owner-1", now })).resolves.toEqual({
      state: "reduced",
      recovery: { kind: "resets_on", date: "2026-11-15" },
    });
  });

  it("pauses at the ceiling until the anchored Usage Period resets", async () => {
    db.reads = [
      [{ anchor: "2026-03-15" }],
      [{ costCategory: "interactive", microUsd: "12000000" }],
    ];

    await expect(readEveUsageNotice({ userId: "owner-1", now })).resolves.toEqual({
      state: "paused",
      recovery: { kind: "resets_on", date: "2026-11-15" },
    });
  });

  it("treats an empty ledger as nothing spent", async () => {
    db.reads = [[{ anchor: "2026-03-15" }], []];

    await expect(readEveUsageNotice({ userId: "owner-1", now })).resolves.toEqual({
      state: "normal",
    });
  });
});

describe("readUsageNotices", () => {
  const paused = { state: "paused", recovery: { kind: "resets_on", date: "2026-11-15" } };

  it("is normal everywhere for an account with no subscription anchor", async () => {
    db.reads = [[{ anchor: null }]];

    const notices = await readUsageNotices({ userId: "owner-1", now });
    expect(Object.values(notices).every((notice) => notice.state === "normal")).toBe(true);
    expect(db.reads).toHaveLength(0);
  });

  it("reads every category's spend from one ledger read", async () => {
    db.reads = [
      [{ anchor: "2026-03-15" }],
      [
        { costCategory: "interactive", microUsd: "1000000" },
        { costCategory: "background", microUsd: "1300000" },
        { costCategory: "web_search", microUsd: "700000" },
      ],
    ];

    await expect(readUsageNotices({ userId: "owner-1", now })).resolves.toEqual({
      eve: { state: "normal" },
      search: { ...paused, state: "reduced" },
      background: paused,
      scheduled: paused,
      webSearch: paused,
    });
  });

  it("treats a category with no ledger rows as nothing spent", async () => {
    db.reads = [[{ anchor: "2026-03-15" }], [{ costCategory: "background", microUsd: "1299999" }]];

    const notices = await readUsageNotices({ userId: "owner-1", now });
    expect(notices.background).toEqual({ state: "normal" });
    expect(notices.webSearch).toEqual({ state: "normal" });
  });
});

describe("readEveOverFairUseBudget", () => {
  it("is false for an account with no subscription anchor", async () => {
    db.reads = [[{ anchor: null }]];

    await expect(readEveOverFairUseBudget({ userId: "owner-1", now })).resolves.toBe(false);
  });

  it("is true from the plan's Fair-Use Budget", async () => {
    db.reads = [
      [{ anchor: "2026-03-15" }],
      [{ costCategory: "interactive", microUsd: "10500000" }],
    ];

    await expect(readEveOverFairUseBudget({ userId: "owner-1", now })).resolves.toBe(true);
  });

  it("is false below it", async () => {
    db.reads = [
      [{ anchor: "2026-03-15" }],
      [{ costCategory: "interactive", microUsd: "10499999" }],
    ];

    await expect(readEveOverFairUseBudget({ userId: "owner-1", now })).resolves.toBe(false);
  });
});

describe("anchorUsagePeriod", () => {
  it("anchors an account that has an Access Profile", async () => {
    db.updated = [{ userId: "owner-1" }];

    await expect(
      anchorUsagePeriod({ userId: "owner-1", startedAt: new Date("2026-03-15T17:04:05Z") }),
    ).resolves.toBeUndefined();
  });

  it("fails rather than leave a paying account unanchored", async () => {
    await expect(
      anchorUsagePeriod({ userId: "owner-1", startedAt: new Date("2026-03-15T17:04:05Z") }),
    ).rejects.toThrow(/No Access Profile/);
  });
});

describe("the Spend Breaker in usage reads", () => {
  const restored = { state: "paused", recovery: { kind: "service_restored" } };

  it("pauses Eve with no reset date once the breaker sheds interactive work", async () => {
    breaker.stage = "interactive";
    db.reads = [[{ anchor: "2026-03-15" }], [{ costCategory: "interactive", microUsd: "1" }]];

    await expect(readEveUsageNotice({ userId: "owner-1", now })).resolves.toEqual(restored);
  });

  it("covers an account with no plan, such as the operator's", async () => {
    breaker.stage = "background";
    db.reads = [[{ anchor: null }]];

    const notices = await readUsageNotices({ userId: "owner-1", now });
    expect(notices.background).toEqual(restored);
    expect(notices.scheduled).toEqual({ state: "normal" });
    expect(notices.eve).toEqual({ state: "normal" });
  });

  it("keeps the account's own ceilings when the breaker cannot be read, and logs it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    breaker.fails = true;
    db.reads = [[{ anchor: "2026-03-15" }], [{ costCategory: "background", microUsd: "1300000" }]];

    const notices = await readUsageNotices({ userId: "owner-1", now });

    expect(notices.background).toEqual({
      state: "paused",
      recovery: { kind: "resets_on", date: "2026-11-15" },
    });
    expect(error).toHaveBeenCalledWith("spend_breaker.read_failed", { reason: "Error" });
    error.mockRestore();
  });

  it("never moves an account to the Fallback Model", async () => {
    breaker.stage = "interactive";
    db.reads = [[{ anchor: "2026-03-15" }], [{ costCategory: "interactive", microUsd: "1" }]];

    await expect(readEveOverFairUseBudget({ userId: "owner-1", now })).resolves.toBe(false);
  });
});
