import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../../client";
import { firstValueHealth, operatorAlerts } from "../../schema";
import { createDrizzleOperatorAlertStore } from "./drizzle-store";
import { observeFirstValue } from "./first-value";
import { runOperatorAlertPass } from "./service";
import type { ClaimedOperatorAlertNotice, OperatorAlertStore } from "./types";

/** Explicit opt-in; each run creates and drops its own loopback-only database. */
const configured = process.env.TENDNOTE_FIRST_VALUE_TEST_DATABASE_URL;
const previousUrl = process.env.DATABASE_URL;
let admin: postgres.Sql;
let databaseName: string;
const at = (slot: number) => new Date(Date.parse("2026-10-23T20:00:00Z") + slot * 600_000);

describe.skipIf(!configured)("First Value durable Postgres contract", () => {
  beforeAll(async () => {
    const url = new URL(configured ?? "");
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.pathname !== "/tendnote_first_value_test"
    ) {
      throw new Error("First Value tests require a dedicated loopback test database prefix");
    }
    databaseName = `tendnote_first_value_test_${randomUUID().replaceAll("-", "")}`;
    url.pathname = "/postgres";
    admin = postgres(url.toString(), { max: 1 });
    await admin`create database ${admin(databaseName)}`;
    url.pathname = `/${databaseName}`;
    process.env.DATABASE_URL = url.toString();
    const connection = postgres(url.toString(), { max: 1 });
    try {
      for (const migration of ["0099_operator_alerts", "0105_first_value_health"]) {
        const sql = await readFile(
          new URL(`../../../migrations/${migration}.sql`, import.meta.url),
          "utf8",
        );
        for (const statement of sql.split("--> statement-breakpoint")) {
          await connection.unsafe(statement);
        }
      }
    } finally {
      await connection.end();
    }
  });

  beforeEach(async () => {
    await getDb().delete(operatorAlerts);
    await getDb().delete(firstValueHealth);
  });

  afterAll(async () => {
    await closeDb();
    if (admin) {
      if (databaseName) await admin`drop database ${admin(databaseName)} with (force)`;
      await admin.end();
    }
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  });

  function harness() {
    const store = createDrizzleOperatorAlertStore({ firstValuePolicy: "ten_minute" });
    const sent: ClaimedOperatorAlertNotice[] = [];
    const sample = (
      outcome: "clean" | "failed" | "retried" | "serious" | "unknown",
      slot: number,
    ) =>
      runOperatorAlertPass({
        store,
        readings: [],
        breaker: "closed",
        now: at(slot),
        firstValue: { at: at(slot), outcome },
        notify: async (notice) => {
          sent.push(notice);
        },
      });
    return { store, sent, sample };
  }

  /** The prelaunch daily policy (ADR 0268); `at(0)` is 20:00 UTC, after the daily hour. */
  function dailyHarness() {
    const store = createDrizzleOperatorAlertStore({ firstValuePolicy: "daily" });
    const sent: ClaimedOperatorAlertNotice[] = [];
    const complete = (
      outcome: "clean" | "failed" | "retried" | "serious" | "unknown",
      slot: number,
      against: OperatorAlertStore = store,
    ) =>
      runOperatorAlertPass({
        store: against,
        readings: [],
        breaker: "closed",
        now: at(slot),
        firstValue: { at: at(slot), outcome },
        notify: async (notice) => {
          sent.push(notice);
        },
      });
    /** One cron pass: the claim, then a sample only when this pass ran the check. */
    const pass = async (outcome: Parameters<typeof complete>[0], slot: number) => {
      if (await store.claimFirstValueRun({ at: at(slot) })) await complete(outcome, slot);
    };
    const daily = async () => (await getDb().select().from(firstValueHealth))[0]?.state.daily;
    return { store, sent, complete, pass, daily };
  }

  it("daily: lets exactly one of many concurrent passes claim the day's run", async () => {
    const h = dailyHarness();
    const claims = await Promise.all(
      Array.from({ length: 12 }, () => h.store.claimFirstValueRun({ at: at(0) })),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    await Promise.all(Array.from({ length: 6 }, () => h.complete("serious", 0)));
    expect(h.sent.map((notice) => notice.kind)).toEqual(["alert"]);
    expect(await h.daily()).toMatchObject({ runs: 1, settled: true, claimedAt: null });
    expect(await h.store.claimFirstValueRun({ at: at(1) })).toBe(false);
  });

  it("daily: migrates an open ten-minute incident without recovering it", async () => {
    const tenMinute = harness();
    await tenMinute.sample("failed", 0);
    await tenMinute.sample("failed", 1);
    await tenMinute.sample("clean", 2);
    expect(tenMinute.sent.map((notice) => notice.kind)).toEqual(["alert"]);
    await closeDb();
    const h = dailyHarness();
    // The transition alone, and a retry-recovered daily check, hold the incident.
    await h.pass("retried", 3);
    const [row] = await getDb().select().from(firstValueHealth);
    expect(row?.state).toMatchObject({ policy: "daily", history: [] });
    expect(h.sent).toEqual([]);
    await h.pass("clean", 3 + 144);
    expect(h.sent.map((notice) => notice.kind)).toEqual(["recovery"]);
  });

  it("daily: rejects a superseded run's late result and persists the claim across restart", async () => {
    const h = dailyHarness();
    expect(await h.store.claimFirstValueRun({ at: at(0) })).toBe(true);
    await closeDb();
    const restarted = dailyHarness();
    // The claim's lease survives the restart: no second paid run.
    expect(await restarted.store.claimFirstValueRun({ at: at(1) })).toBe(false);
    expect(await restarted.store.claimFirstValueRun({ at: at(2) })).toBe(true);
    await restarted.complete("serious", 0);
    expect(restarted.sent).toEqual([]);
    expect(await restarted.daily()).toMatchObject({ runs: 2, claimedAt: at(2).getTime() });
    await restarted.complete("failed", 2);
    await restarted.complete("failed", 2);
    expect(restarted.sent).toEqual([]);
    await restarted.pass("failed", 3);
    expect(restarted.sent.map((notice) => notice.openedAt)).toEqual([at(2)]);
  });

  it("daily: rolls the completion back with its episode write, keeping the run claimed", async () => {
    const h = dailyHarness();
    await h.pass("failed", 0);
    expect(await h.store.claimFirstValueRun({ at: at(1) })).toBe(true);
    const failing: OperatorAlertStore = {
      ...h.store,
      open: async (input) => {
        await h.store.open(input);
        throw new Error("rollback");
      },
    };
    await expect(
      observeFirstValue({ sample: { at: at(1), outcome: "failed" }, at: at(1) }, failing, "daily"),
    ).rejects.toThrow("rollback");
    expect(await getDb().select().from(operatorAlerts)).toEqual([]);
    expect(await h.daily()).toMatchObject({ claimedAt: at(1).getTime(), settled: false });
    await h.complete("failed", 1);
    expect(h.sent.map((notice) => [notice.kind, notice.openedAt])).toEqual([["alert", at(0)]]);
  });

  it("daily: restoring the ten-minute policy needs two clean slots for an open incident", async () => {
    const h = dailyHarness();
    await h.pass("serious", 0);
    expect(h.sent.map((notice) => notice.kind)).toEqual(["alert"]);
    const tenMinute = harness();
    await tenMinute.sample("clean", 145);
    const [row] = await getDb().select().from(firstValueHealth);
    expect(row?.state).toMatchObject({ policy: "ten_minute", history: [{ outcome: "clean" }] });
    expect(row?.state.daily).toBeUndefined();
    expect(tenMinute.sent).toEqual([]);
    await tenMinute.sample("clean", 146);
    expect(tenMinute.sent.map((notice) => notice.kind)).toEqual(["recovery"]);
  });

  it("counts concurrent duplicate deliveries once and claims one confirmed incident notice", async () => {
    const h = harness();
    await Promise.all(Array.from({ length: 12 }, () => h.sample("failed", 0)));
    expect(h.sent).toEqual([]);
    await Promise.all(Array.from({ length: 12 }, () => h.sample("failed", 1)));
    expect(h.sent.map((notice) => notice.kind)).toEqual(["alert"]);
    const [row] = await getDb().select().from(firstValueHealth);
    expect(row?.state.history).toHaveLength(2);
    expect(h.sent[0]?.firstValueContext?.failed).toBe(2);
    expect(h.sent[0]?.openedAt).toEqual(at(0));
  });

  it("persists across connections and rejects older success before confirming recovery", async () => {
    const h = harness();
    await h.sample("failed", 0);
    await closeDb();
    const restarted = harness();
    await restarted.sample("failed", 1);
    await restarted.sample("clean", 2);
    await restarted.sample("clean", 0);
    expect(restarted.sent.map((notice) => notice.kind)).toEqual(["alert"]);
    await restarted.sample("clean", 3);
    expect(restarted.sent.map((notice) => notice.kind)).toEqual(["alert", "recovery"]);
  });

  it("does not let a racing same-slot clean result hide a serious failure", async () => {
    const h = harness();
    await Promise.all([h.sample("clean", 0), h.sample("serious", 0), h.sample("unknown", 0)]);
    expect(h.sent.map((notice) => notice.kind)).toEqual(["alert"]);
    const [row] = await getDb().select().from(firstValueHealth);
    expect(row?.state.history).toMatchObject([{ outcome: "serious" }]);
  });

  it("persists a recovery boundary without discarding degradation-summary evidence", async () => {
    const h = harness();
    await h.sample("failed", 0);
    await h.sample("failed", 1);
    await h.sample("clean", 2);
    await h.sample("clean", 3);
    await closeDb();
    const restarted = harness();
    await restarted.sample("failed", 4);
    expect(restarted.sent.map((notice) => notice.condition)).toEqual(["first_value_degradation"]);
    expect(restarted.sent[0]?.firstValueContext?.failed).toBe(3);
    await restarted.sample("failed", 5);
    const incident = restarted.sent.find((notice) => notice.condition === "first_value_path");
    expect(incident?.openedAt).toEqual(at(4));
    expect(incident?.firstValueContext).toMatchObject({ failed: 2, samples: 2 });
  });

  it("holds a pre-migration incident through unknowns, retries, and gaps", async () => {
    const h = harness();
    await h.store.open({ condition: "first_value_path", at: at(0) });
    await h.sample("unknown", 0);
    await h.sample("clean", 1);
    await h.sample("retried", 2);
    await h.sample("clean", 3);
    await h.sample("clean", 5);
    expect(h.sent.map((notice) => notice.kind)).toEqual(["alert"]);
    await h.sample("clean", 6);
    expect(h.sent.map((notice) => notice.kind)).toEqual(["alert", "recovery"]);
  });

  it("rolls back the sample and episode together when an episode write fails", async () => {
    const h = harness();
    await h.sample("failed", 0);
    await expect(
      observeFirstValue(
        { sample: { at: at(1), outcome: "failed" }, at: at(1) },
        {
          ...h.store,
          open: async (input) => {
            await h.store.open(input);
            throw new Error("rollback");
          },
        },
        "ten_minute",
      ),
    ).rejects.toThrow("rollback");
    expect(await getDb().select().from(operatorAlerts)).toEqual([]);
    const [row] = await getDb().select().from(firstValueHealth);
    expect(row?.state.history).toHaveLength(1);
    await h.sample("failed", 1);
    expect(h.sent).toHaveLength(1);
  });

  it("persists the summary rate limit and immutable counts; sends no summary recovery", async () => {
    const h = harness();
    await h.sample("retried", 0);
    await h.sample("retried", 1);
    await h.sample("retried", 2);
    expect(h.sent).toHaveLength(1);
    await closeDb();
    const restarted = harness();
    await restarted.sample("retried", 3);
    expect(restarted.sent).toEqual([]);
    for (const slot of [36, 37, 38]) await restarted.sample("retried", slot);
    expect(restarted.sent.map((notice) => [notice.condition, notice.kind])).toEqual([
      ["first_value_degradation", "alert"],
    ]);
    expect(h.sent[0]?.firstValueContext).toMatchObject({ samples: 3, failed: 0, retried: 3 });
  });

  it("reports a serious failure immediately and holds stale clean data", async () => {
    const h = harness();
    await h.sample("serious", 0);
    await h.sample("clean", 1);
    await runOperatorAlertPass({
      store: h.store,
      readings: [],
      breaker: "closed",
      now: new Date(at(2).getTime() + 300_001),
      firstValue: { at: at(2), outcome: "clean" },
      notify: async (notice) => {
        h.sent.push(notice);
      },
    });
    await h.sample("clean", 3);
    expect(h.sent.map((notice) => notice.kind)).toEqual(["alert"]);
  });
});
