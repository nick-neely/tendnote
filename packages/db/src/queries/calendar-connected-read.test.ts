import { describe, expect, it, vi } from "vitest";
import { readConnectedOwnerCalendar } from "./calendar";
import { createFailingCalendarAdapter, createFakeCalendarAdapter } from "./calendar/fake-adapter";
import { createInMemoryCalendarCacheStore } from "./calendar/in-memory-store";
import { createCalendarReader } from "./calendar/reader";

const CONNECTION = { ownerUserId: "owner-1", providerKey: "google", capabilityKey: "calendar" };
const REQUEST = {
  ...CONNECTION,
  timeMin: new Date("2026-06-29T00:00:00.000Z"),
  timeMax: new Date("2026-07-06T00:00:00.000Z"),
};

function event() {
  return {
    providerEventId: "evt-1",
    calendarId: "primary",
    title: "Coffee with Maya",
    start: new Date("2026-06-30T15:00:00.000Z"),
    end: new Date("2026-06-30T15:30:00.000Z"),
    allDay: false,
    status: "confirmed" as const,
    attendees: [],
    location: null,
    description: null,
    updatedAt: null,
  };
}

describe("readConnectedOwnerCalendar", () => {
  it("does not read when the connection is not connected", async () => {
    const reader = createCalendarReader({
      adapter: createFakeCalendarAdapter([event()]),
      cacheStore: createInMemoryCalendarCacheStore(),
      now: () => 1000,
    });
    const readSpy = vi.spyOn(reader, "readCalendarEvents");

    const outcome = await readConnectedOwnerCalendar(REQUEST, {
      reader,
      isConnected: async () => false,
    });

    expect(outcome).toEqual({ connected: false, result: null });
    expect(readSpy).not.toHaveBeenCalled();
  });

  it("reads the bounded window through the reader when connected", async () => {
    const reader = createCalendarReader({
      adapter: createFakeCalendarAdapter([event()]),
      cacheStore: createInMemoryCalendarCacheStore(),
      now: () => 1000,
    });

    const outcome = await readConnectedOwnerCalendar(REQUEST, {
      reader,
      isConnected: async () => true,
    });

    expect(outcome.connected).toBe(true);
    expect(outcome.result?.events).toHaveLength(1);
  });

  it("degrades to result:null when connected but the read is unavailable", async () => {
    const reader = createCalendarReader({
      adapter: createFailingCalendarAdapter(),
      cacheStore: createInMemoryCalendarCacheStore(),
      now: () => 1000,
    });

    const outcome = await readConnectedOwnerCalendar(REQUEST, {
      reader,
      isConnected: async () => true,
    });

    expect(outcome).toEqual({ connected: true, result: null });
  });
});
