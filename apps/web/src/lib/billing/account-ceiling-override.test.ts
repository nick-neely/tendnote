import type { RecoveryJournalRecord } from "@tendnote/domain";
import {
  HOSTED_PLAN,
  usageNotices,
  usagePeriod,
  withCeilingOverrides,
} from "@tendnote/domain/usage-bounds";
import { describe, expect, it, vi } from "vitest";
import { raiseAccountCeiling } from "./account-ceiling-override";
import { createCeilingOverridesFake } from "./account-ceiling-overrides-fake";

const USER = "subscriber-1";
const ANCHOR = "2026-03-15";
const PERIOD = { start: "2026-10-15", resetsOn: "2026-11-15" };
const NOW = new Date("2026-10-20T12:00:00Z");

function operator(period: typeof PERIOD | null = PERIOD) {
  const fake = createCeilingOverridesFake({ period });
  const journaled: RecoveryJournalRecord[] = [];
  const deps = {
    ceilings: fake.ceilings,
    journal: { write: vi.fn(async (record: RecoveryJournalRecord) => void journaled.push(record)) },
  };
  /** Interactive Eve's notice at `spentUsd` in the period `at` falls in, under that period's overrides. */
  async function eveAt(spentUsd: number, at: Date) {
    const atPeriod = usagePeriod(ANCHOR, at);
    const overrides = await fake.ceilings.readCeilingOverrides({ userId: USER, period: atPeriod });
    return usageNotices({
      plan: withCeilingOverrides(HOSTED_PLAN, overrides),
      spend: {
        period: atPeriod,
        spentMicroUsd: { interactive: spentUsd * 1_000_000, background: 0, web_search: 0 },
      },
    }).eve;
  }
  return { deps, overrides: fake.overrides, journaled, eveAt };
}

describe("raising the Account Ceiling for the current period (#633)", () => {
  it("raises one category for the running Usage Period, expiring when it resets, and journals it", async () => {
    const op = operator();

    await expect(
      raiseAccountCeiling(op.deps, {
        userId: USER,
        category: "interactive",
        ceilingUsd: 20,
        now: NOW,
      }),
    ).resolves.toEqual({
      overrideId: "override_1",
      costCategory: "interactive",
      ceilingUsd: 20,
      expiresOn: "2026-11-15",
    });
    expect(op.overrides).toEqual([
      expect.objectContaining({
        userId: USER,
        costCategory: "interactive",
        ceilingMicroUsd: 20_000_000,
        periodStart: "2026-10-15",
        expiresOn: "2026-11-15",
        grantedAt: NOW,
      }),
    ]);
    expect(op.journaled).toEqual([
      { kind: "ceiling-override", accountId: USER, actionId: "override_1", at: NOW },
    ]);
  });

  it("lifts the pause for the rest of the period only", async () => {
    const op = operator();
    expect(await op.eveAt(12, NOW)).toMatchObject({ state: "paused" });

    await raiseAccountCeiling(op.deps, {
      userId: USER,
      category: "interactive",
      ceilingUsd: 20,
      now: NOW,
    });

    // Past the Fair-Use Budget it is still reduced to the Fallback Model; never overridden.
    expect(await op.eveAt(12, NOW)).toMatchObject({ state: "reduced" });
    expect(await op.eveAt(12, new Date("2026-11-14T23:59:59Z"))).toMatchObject({
      state: "reduced",
    });
    expect(await op.eveAt(20, NOW)).toMatchObject({ state: "paused" });
    expect(await op.eveAt(12, new Date("2026-11-15T00:00:00Z"))).toMatchObject({
      state: "paused",
    });
  });

  it("only raises: a figure at or below the ceiling in force is refused, writing nothing", async () => {
    const op = operator();

    for (const ceilingUsd of [12, 5]) {
      await expect(
        raiseAccountCeiling(op.deps, {
          userId: USER,
          category: "interactive",
          ceilingUsd,
          now: NOW,
        }),
      ).rejects.toThrow("The interactive Account Ceiling is already $12.00 this period");
    }
    await raiseAccountCeiling(op.deps, {
      userId: USER,
      category: "web_search",
      ceilingUsd: 1.4,
      now: NOW,
    });
    await expect(
      raiseAccountCeiling(op.deps, {
        userId: USER,
        category: "web_search",
        ceilingUsd: 1,
        now: NOW,
      }),
    ).rejects.toThrow("already $1.40");
    expect(op.overrides).toHaveLength(1);
  });

  it("raises again within the period, and the highest raise applies", async () => {
    const op = operator();

    for (const ceilingUsd of [20, 30]) {
      await raiseAccountCeiling(op.deps, {
        userId: USER,
        category: "interactive",
        ceilingUsd,
        now: NOW,
      });
    }

    expect(await op.eveAt(25, NOW)).toMatchObject({ state: "reduced" });
    expect(op.journaled).toEqual([
      expect.objectContaining({ actionId: "override_1" }),
      expect.objectContaining({ actionId: "override_2" }),
    ]);
  });

  it("resumes a retried raise on its own record, journaling it again", async () => {
    const op = operator();
    const raise = { userId: USER, category: "background", ceilingUsd: 2.6, now: NOW };

    await raiseAccountCeiling(op.deps, raise);
    await expect(raiseAccountCeiling(op.deps, raise)).resolves.toMatchObject({
      overrideId: "override_1",
    });

    expect(op.overrides).toHaveLength(1);
    expect(op.journaled).toEqual([
      expect.objectContaining({ actionId: "override_1" }),
      expect.objectContaining({ actionId: "override_1" }),
    ]);
  });

  it("refuses an unknown category, an amount that is not one, and an account with no Usage Period", async () => {
    const op = operator();

    await expect(
      raiseAccountCeiling(op.deps, { userId: USER, category: "eve", ceilingUsd: 20, now: NOW }),
    ).rejects.toThrow("A cost category is one of interactive, background, web_search.");
    await expect(
      raiseAccountCeiling(op.deps, {
        userId: USER,
        category: "interactive",
        ceilingUsd: Number("twenty"),
        now: NOW,
      }),
    ).rejects.toThrow("An Account Ceiling is an amount in dollars");
    await expect(
      raiseAccountCeiling(operator(null).deps, {
        userId: USER,
        category: "interactive",
        ceilingUsd: 20,
        now: NOW,
      }),
    ).rejects.toThrow("has no Usage Period");
    expect(op.overrides).toEqual([]);
    expect(op.journaled).toEqual([]);
  });
});
