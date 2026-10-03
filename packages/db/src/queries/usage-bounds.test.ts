import { beforeEach, describe, expect, it, vi } from "vitest";

/** What the fake database answers: the profile read first, then the ledger sum. */
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

import { anchorUsagePeriod, readEveUsageNotice } from "./usage-bounds";

const now = new Date("2026-10-20T12:00:00Z");

beforeEach(() => {
  db.reads = [];
  db.updated = [];
});

describe("readEveUsageNotice", () => {
  it("is normal for an account with no subscription anchor, without reading the ledger", async () => {
    db.reads = [[{ anchor: null }], [{ microUsd: "99000000" }]];

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

  it("is normal below the plan's interactive ceiling", async () => {
    db.reads = [[{ anchor: "2026-03-15" }], [{ microUsd: "11999999" }]];

    await expect(readEveUsageNotice({ userId: "owner-1", now })).resolves.toEqual({
      state: "normal",
    });
  });

  it("pauses at the ceiling until the anchored Usage Period resets", async () => {
    db.reads = [[{ anchor: "2026-03-15" }], [{ microUsd: "12000000" }]];

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
