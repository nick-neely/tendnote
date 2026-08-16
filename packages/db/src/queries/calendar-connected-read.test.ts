import { describe, expect, it, vi } from "vitest";
import { createDefaultGoogleCalendarReader, readConnectedOwnerCalendar } from "./calendar";
import { CalendarAuthorizationError } from "./calendar/errors";
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

  it("marks authorization failures for reconnect and reports them to the caller", async () => {
    const reader = createCalendarReader({
      adapter: {
        listEvents: async () => {
          throw new CalendarAuthorizationError("provider", { status: 401 });
        },
      },
      cacheStore: createInMemoryCalendarCacheStore(),
      now: () => 1000,
    });
    const onAuthorizationFailure = vi.fn().mockResolvedValue(undefined);

    const outcome = await readConnectedOwnerCalendar(REQUEST, {
      reader,
      isConnected: async () => true,
      onAuthorizationFailure,
    });

    expect(outcome).toEqual({
      connected: true,
      result: null,
      requiresReauthorization: true,
    });
    expect(onAuthorizationFailure).toHaveBeenCalledWith({
      ref: CONNECTION,
      error: expect.objectContaining({ kind: "provider", status: 401 }),
    });
  });

  it("can read live on cache miss through the Better Auth token bridge composition", async () => {
    const tokenCalls: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id: "evt-live",
            summary: "Live coffee",
            start: { dateTime: "2026-06-30T15:00:00.000Z" },
            end: { dateTime: "2026-06-30T15:30:00.000Z" },
            attendees: [{ email: "maya@example.com", displayName: "Maya", self: false }],
            rawPayloadMustNotLeak: "secret",
          },
        ],
      }),
      text: async () => "",
    } as Response);
    const reader = createDefaultGoogleCalendarReader({
      cacheStore: createInMemoryCalendarCacheStore(),
      getAccessToken: async (ref) => {
        tokenCalls.push(ref.ownerUserId);
        return "live-token";
      },
      now: () => 1000,
    });

    const outcome = await readConnectedOwnerCalendar(REQUEST, {
      reader,
      isConnected: async () => true,
    });

    expect(outcome.connected).toBe(true);
    expect(outcome.result?.source).toBe("live");
    expect(outcome.result?.events[0]).toMatchObject({
      providerEventId: "evt-live",
      title: "Live coffee",
    });
    expect(Object.keys(outcome.result?.events[0] ?? {})).not.toContain("rawPayloadMustNotLeak");
    expect(tokenCalls).toEqual(["owner-1"]);
    expect(fetchSpy.mock.calls[0]?.[1]?.headers).toEqual({ authorization: "Bearer live-token" });
    fetchSpy.mockRestore();
  });
});
