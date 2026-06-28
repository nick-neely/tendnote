import { describe, expect, it } from "vitest";
import { ensureDefaultBriefSchedules } from "./defaults";
import { createInMemoryBriefScheduleStore } from "./in-memory-store";

const OWNER = "user-1";
const NOW = new Date("2026-06-27T09:00:00Z");

describe("ensureDefaultBriefSchedules", () => {
  it("creates default-enabled daily and weekly schedules for the owner", async () => {
    const store = createInMemoryBriefScheduleStore();

    await ensureDefaultBriefSchedules(store, { ownerUserId: OWNER, timezone: "UTC", now: NOW });

    const schedules = await store.listBriefSchedulesForOwner({ ownerUserId: OWNER });
    expect(schedules.map((schedule) => schedule.cadence).sort()).toEqual(["daily", "weekly"]);
    expect(schedules.every((schedule) => schedule.enabled)).toBe(true);
    expect(schedules.every((schedule) => schedule.nextRunAt.getTime() > NOW.getTime())).toBe(true);
    expect(schedules.find((schedule) => schedule.cadence === "weekly")?.weekday).toBe(1);
  });

  it("is idempotent and does not duplicate existing schedules", async () => {
    const store = createInMemoryBriefScheduleStore();

    await ensureDefaultBriefSchedules(store, { ownerUserId: OWNER, timezone: "UTC", now: NOW });
    await ensureDefaultBriefSchedules(store, { ownerUserId: OWNER, timezone: "UTC", now: NOW });

    const schedules = await store.listBriefSchedulesForOwner({ ownerUserId: OWNER });
    expect(schedules).toHaveLength(2);
  });

  it("respects a schedule the owner has disabled", async () => {
    const store = createInMemoryBriefScheduleStore();
    await ensureDefaultBriefSchedules(store, { ownerUserId: OWNER, timezone: "UTC", now: NOW });
    await store.setBriefScheduleEnabled({ ownerUserId: OWNER, cadence: "daily", enabled: false });

    await ensureDefaultBriefSchedules(store, { ownerUserId: OWNER, timezone: "UTC", now: NOW });

    const daily = await store.getBriefScheduleForOwner({ ownerUserId: OWNER, cadence: "daily" });
    expect(daily?.enabled).toBe(false);
  });
});
