import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../client";
import { user } from "../schema";
import { createDrizzleBirthdayGiftPlanningStore } from "./birthday-gift-planning";
import { createDrizzleBriefScheduleStore } from "./brief-schedules/drizzle-store";

/** Explicit opt-in; every run creates and drops a dedicated loopback database. */
const configured = process.env.TENDNOTE_SCHEDULE_RETRY_TEST_DATABASE_URL;
const previousUrl = process.env.DATABASE_URL;
const OWNER = "schedule-retry-fixture";
const NOW = new Date("2026-11-02T09:00:00Z");
const RETRY_AT = new Date("2026-11-02T09:15:00Z");
let admin: postgres.Sql | undefined;
let databaseName: string | undefined;

describe.skipIf(!configured)("scheduled workflow retry holds in Postgres", () => {
  beforeAll(async () => {
    const url = new URL(configured ?? "");
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.pathname !== "/tendnote_schedule_retry_test"
    ) {
      throw new Error("Schedule retry tests require a dedicated loopback test database prefix");
    }
    databaseName = `tendnote_schedule_retry_test_${randomUUID().replaceAll("-", "")}`;
    url.pathname = "/postgres";
    admin = postgres(url.toString(), { max: 1 });
    await admin`create database ${admin(databaseName)}`;
    url.pathname = `/${databaseName}`;
    process.env.DATABASE_URL = url.toString();
    await migrate(getDb(), {
      migrationsFolder: fileURLToPath(new URL("../../migrations", import.meta.url)),
    });
    await getDb().insert(user).values({
      id: OWNER,
      name: "Schedule fixture",
      email: "schedule-fixture@example.invalid",
    });
  }, 30_000);

  afterAll(async () => {
    try {
      await closeDb();
      if (admin && databaseName) await admin`drop database ${admin(databaseName)} with (force)`;
    } finally {
      await admin?.end();
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
    }
  });

  it("persists a brief hold across reconnects, blocks early claims, and clears it on roll-forward", async () => {
    const store = createDrizzleBriefScheduleStore();
    const schedule = await store.createBriefSchedule({
      ownerUserId: OWNER,
      cadence: "daily",
      timezone: "UTC",
      runAtMinute: 540,
      weekday: null,
      nextRunAt: NOW,
      enabled: true,
      leaseExpiresAt: null,
      attempts: 0,
      lastError: null,
      lastRunAt: null,
    });
    expect(await store.claimDueBriefSchedules({ now: NOW, leaseMs: 300_000 })).toHaveLength(1);
    const held = await store.releaseBriefSchedule({
      id: schedule.id,
      lastError: "fixture",
      retryAt: RETRY_AT,
    });
    expect(held).toMatchObject({ attempts: 1, nextRunAt: NOW, leaseExpiresAt: RETRY_AT });
    await closeDb();
    const restarted = createDrizzleBriefScheduleStore();
    expect(
      await restarted.claimDueBriefSchedules({
        now: new Date("2026-11-02T09:10:00Z"),
        leaseMs: 300_000,
      }),
    ).toEqual([]);
    expect(
      (await restarted.claimDueBriefSchedules({ now: RETRY_AT, leaseMs: 300_000 }))[0]?.attempts,
    ).toBe(2);
    const cleared = await restarted.releaseBriefSchedule({
      id: schedule.id,
      lastError: "gave up",
      nextRunAt: new Date("2026-11-03T09:00:00Z"),
      retryAt: RETRY_AT,
    });
    expect(cleared).toMatchObject({ attempts: 0, leaseExpiresAt: null });
  });

  it("persists a birthday hold across reconnects, blocks early claims, and clears it on success", async () => {
    const store = createDrizzleBirthdayGiftPlanningStore();
    const schedule = await store.ensureSchedule({
      ownerUserId: OWNER,
      timezone: "UTC",
      now: new Date("2026-11-02T08:59:00Z"),
    });
    expect(
      await store.claimDueSchedule({ ownerUserId: OWNER, now: NOW, leaseMs: 300_000 }),
    ).not.toBeNull();
    const held = await store.releaseSchedule({
      id: schedule.id,
      lastError: "fixture",
      retryAt: RETRY_AT,
    });
    expect(held).toMatchObject({ attempts: 1, nextRunAt: NOW, leaseExpiresAt: RETRY_AT });
    await closeDb();
    const restarted = createDrizzleBirthdayGiftPlanningStore();
    expect(
      await restarted.claimDueSchedule({
        ownerUserId: OWNER,
        now: new Date("2026-11-02T09:10:00Z"),
        leaseMs: 300_000,
      }),
    ).toBeNull();
    expect(
      (await restarted.claimDueSchedule({ ownerUserId: OWNER, now: RETRY_AT, leaseMs: 300_000 }))
        ?.attempts,
    ).toBe(2);
    const cleared = await restarted.completeSchedule({
      id: schedule.id,
      nextRunAt: new Date("2026-11-03T09:00:00Z"),
      ranAt: RETRY_AT,
    });
    expect(cleared).toMatchObject({ attempts: 0, lastError: null, leaseExpiresAt: null });
  });
});
