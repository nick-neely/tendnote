import { describe, expect, it } from "vitest";
import {
  type BriefScheduleRecurrence,
  computeNextBriefRun,
  formatLocalDate,
  zonedWallTimeToUtc,
} from "./brief-schedules";

const utcDaily: BriefScheduleRecurrence = {
  cadence: "daily",
  timezone: "UTC",
  runAtMinute: 8 * 60,
  weekday: null,
};

describe("computeNextBriefRun — daily", () => {
  it("returns today's run when the time has not passed", () => {
    const next = computeNextBriefRun(utcDaily, new Date("2026-06-27T07:00:00Z"));
    expect(next.toISOString()).toBe("2026-06-27T08:00:00.000Z");
  });

  it("rolls to tomorrow once the time has passed", () => {
    const next = computeNextBriefRun(utcDaily, new Date("2026-06-27T09:00:00Z"));
    expect(next.toISOString()).toBe("2026-06-28T08:00:00.000Z");
  });

  it("resolves a timezone's local wall-clock time to the right UTC instant", () => {
    // 08:00 in Los Angeles (PDT, UTC-7 in June) is 15:00 UTC.
    const la: BriefScheduleRecurrence = {
      cadence: "daily",
      timezone: "America/Los_Angeles",
      runAtMinute: 8 * 60,
      weekday: null,
    };
    const next = computeNextBriefRun(la, new Date("2026-06-27T16:00:00Z"));
    expect(next.toISOString()).toBe("2026-06-28T15:00:00.000Z");
  });
});

describe("computeNextBriefRun — weekly", () => {
  it("returns the next occurrence of the configured weekday at the local time", () => {
    const weekly: BriefScheduleRecurrence = {
      cadence: "weekly",
      timezone: "UTC",
      runAtMinute: 8 * 60,
      weekday: 1, // Monday
    };
    const next = computeNextBriefRun(weekly, new Date("2026-06-27T09:00:00Z")); // a Saturday
    expect(next.getUTCDay()).toBe(1);
    expect(next.toISOString()).toBe("2026-06-29T08:00:00.000Z");
  });

  it("throws if a weekly schedule has no weekday", () => {
    expect(() =>
      computeNextBriefRun(
        { cadence: "weekly", timezone: "UTC", runAtMinute: 480, weekday: null },
        new Date("2026-06-27T09:00:00Z"),
      ),
    ).toThrow(/weekday/);
  });
});

describe("timezone helpers", () => {
  it("formats the local date across a UTC day boundary", () => {
    // 06:00 UTC is the previous evening in Los Angeles.
    expect(formatLocalDate("America/Los_Angeles", new Date("2026-06-28T06:00:00Z"))).toBe(
      "2026-06-27",
    );
    expect(formatLocalDate("UTC", new Date("2026-06-28T06:00:00Z"))).toBe("2026-06-28");
  });

  it("round-trips a wall time back to its local date", () => {
    const instant = zonedWallTimeToUtc({
      timeZone: "America/Los_Angeles",
      year: 2026,
      month: 6,
      day: 28,
      minute: 8 * 60,
    });
    expect(instant.toISOString()).toBe("2026-06-28T15:00:00.000Z");
    expect(formatLocalDate("America/Los_Angeles", instant)).toBe("2026-06-28");
  });
});
