import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type DayRow = {
  day: string;
  admittedAccounts: number;
  ceilingMicroUsd: number;
  backgroundShedAt: Date | null;
  scheduledShedAt: Date | null;
  interactiveShedAt: Date | null;
};

/**
 * A fake database answering by table: today's breaker row, the admitted-account
 * count, and the Usage Ledger's sum for the day. An update stamps only columns
 * still empty, as the real `where ... is null` does.
 */
const db = vi.hoisted(() => ({
  day: null as DayRow | null,
  admitted: 0,
  spentMicroUsd: "0",
  reads: 0,
  inserts: 0,
  /** Another reader stamps the column first, so this reader's update stamps nothing. */
  loseStampRace: false,
  failUpdate: false,
}));

vi.mock("../client", async () => {
  const schema = await import("../schema");
  const rowsFor = (table: unknown): unknown[] => {
    db.reads += 1;
    if (table === schema.spendBreakerDays) return db.day ? [db.day] : [];
    if (table === schema.accessProfiles) return [{ accounts: db.admitted }];
    if (table === schema.usageLedger) return [{ microUsd: db.spentMicroUsd }];
    throw new Error("unexpected table");
  };
  const select = () => ({
    from: (table: unknown) => {
      const query = {
        where: () => query,
        limit: async () => rowsFor(table),
        // biome-ignore lint/suspicious/noThenProperty: a drizzle query is awaited directly.
        then: (resolve: (value: unknown[]) => unknown) => resolve(rowsFor(table)),
      };
      return query;
    },
  });
  return {
    getDb: () => ({
      select,
      insert: () => ({
        values: (
          values: Omit<DayRow, "backgroundShedAt" | "scheduledShedAt" | "interactiveShedAt">,
        ) => ({
          onConflictDoNothing: async () => {
            db.inserts += 1;
            db.day ??= {
              ...values,
              backgroundShedAt: null,
              scheduledShedAt: null,
              interactiveShedAt: null,
            };
          },
        }),
      }),
      update: () => ({
        set: (values: Partial<DayRow>) => ({
          where: () => ({
            returning: async () => {
              if (db.failUpdate) throw new Error("database unavailable");
              const day = db.day;
              if (!day || db.loseStampRace) return [];
              const [column] = Object.keys(values) as (keyof DayRow)[];
              if (!column || day[column] !== null) return [];
              Object.assign(day, values);
              return [{ day: day.day }];
            },
          }),
        }),
      }),
    }),
  };
});

import { readSpendBreakerStage } from "./spend-breaker";

const now = new Date("2026-10-20T12:00:00Z");
const hosted = { TENDNOTE_ADMISSION_MODE: "hosted" };
const read = () => readSpendBreakerStage({ now, env: hosted });

function openDay(ceilingMicroUsd: number, admittedAccounts = 10) {
  db.day = {
    day: "2026-10-20",
    admittedAccounts,
    ceilingMicroUsd,
    backgroundShedAt: null,
    scheduledShedAt: null,
    interactiveShedAt: null,
  };
}

let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  Object.assign(db, {
    day: null,
    admitted: 0,
    spentMicroUsd: "0",
    reads: 0,
    inserts: 0,
    loseStampRace: false,
    failUpdate: false,
  });
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  error.mockRestore();
});

describe("readSpendBreakerStage", () => {
  it("stays closed on a self-hosted deployment without reading anything", async () => {
    await expect(
      readSpendBreakerStage({
        now,
        env: {
          TENDNOTE_ADMISSION_MODE: "self-hosted",
          TENDNOTE_SELF_HOSTED_BOOTSTRAP_OWNER_EMAIL: "owner@example.com",
        },
      }),
    ).resolves.toBe("closed");
    expect(db.reads).toBe(0);
  });

  it("opens the day with a ceiling computed from the accounts admitted now", async () => {
    db.admitted = 10;
    db.spentMicroUsd = "14333332";

    await expect(read()).resolves.toBe("closed");
    expect(db.day).toMatchObject({
      day: "2026-10-20",
      admittedAccounts: 10,
      ceilingMicroUsd: 14_333_333,
    });
  });

  it("keeps the day's ceiling for the rest of the day, however admissions change", async () => {
    openDay(5_933_333, 1);
    db.admitted = 500;
    db.spentMicroUsd = "6000000";

    await expect(read()).resolves.toBe("background");
    expect(db.inserts).toBe(0);
  });

  it("trips at the ceiling, stamps the day, and logs one alertable record", async () => {
    openDay(10_000_000);
    db.spentMicroUsd = "10000000";

    await expect(read()).resolves.toBe("background");
    expect(db.day?.backgroundShedAt).toEqual(now);
    expect(db.day?.scheduledShedAt).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("spend_breaker.shed", {
      day: "2026-10-20",
      stage: "background",
      spentMicroUsd: 10_000_000,
      ceilingMicroUsd: 10_000_000,
      admittedAccounts: 10,
    });

    // The next read on the same day sheds the same and alerts nothing new.
    await expect(read()).resolves.toBe("background");
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("records each stage it reaches, so a jump past several records them all", async () => {
    openDay(10_000_000);
    db.spentMicroUsd = "15000000";

    await expect(read()).resolves.toBe("interactive");
    expect(db.day).toMatchObject({
      backgroundShedAt: now,
      scheduledShedAt: now,
      interactiveShedAt: now,
    });
    expect(
      error.mock.calls.map((call: unknown[]) => [call[0], (call[1] as { stage: string }).stage]),
    ).toEqual([
      ["spend_breaker.shed", "background"],
      ["spend_breaker.shed", "scheduled"],
      ["spend_breaker.shed", "interactive"],
    ]);
  });

  it("leaves the alert to the reader that stamped the stage", async () => {
    openDay(10_000_000);
    db.spentMicroUsd = "10000000";
    db.loseStampRace = true;

    await expect(read()).resolves.toBe("background");
    expect(error).not.toHaveBeenCalled();
  });

  it("still sheds when the trip cannot be recorded, and says the record failed", async () => {
    openDay(10_000_000);
    db.spentMicroUsd = "12500000";
    db.failUpdate = true;

    await expect(read()).resolves.toBe("scheduled");
    expect(error).toHaveBeenCalledWith(
      "spend_breaker.record_failed",
      expect.objectContaining({ stage: "background" }),
    );
  });

  it("writes nothing while closed", async () => {
    openDay(10_000_000);
    db.spentMicroUsd = "9999999";

    await expect(read()).resolves.toBe("closed");
    expect(db.day?.backgroundShedAt).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("reminder delivery", () => {
  /** Every module reminder delivery reaches through relative imports. */
  function reachableModules(entry: string): Set<string> {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      for (const [, specifier] of source.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) {
        const base = resolve(dirname(file), specifier as string);
        for (const candidate of [`${base}.ts`, join(base, "index.ts")]) {
          try {
            readFileSync(candidate);
            visit(candidate);
            break;
          } catch {}
        }
      }
    };
    visit(entry);
    return seen;
  }

  it("never reaches the Spend Breaker, a usage notice, or the model-call entry point", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const reached = [...reachableModules(join(here, "reminders/index.ts"))].map((file) =>
      file.slice(here.length + 1),
    );

    expect(reached).toContain("reminders/dispatch.ts");
    expect(reached).not.toContain("spend-breaker.ts");
    expect(reached).not.toContain("usage-bounds.ts");
    expect(reached).not.toContain("model-calls.ts");
  });
});
