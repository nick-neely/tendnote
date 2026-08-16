import type { CalendarEventSummary } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { CalendarAuthorizationError } from "./calendar/errors";
import { createFailingCalendarAdapter, createFakeCalendarAdapter } from "./calendar/fake-adapter";
import { createInMemoryCalendarCacheStore } from "./calendar/in-memory-store";
import {
  CalendarUnavailableError,
  createCalendarReader,
  DEFAULT_CALENDAR_STALE_MAX_MS,
  DEFAULT_CALENDAR_TTL_MS,
} from "./calendar/reader";
import type { CalendarCacheEntry } from "./calendar/types";

const OWNER = "owner-1";
const CONNECTION = { ownerUserId: OWNER, providerKey: "google", capabilityKey: "calendar" };
const WINDOW = {
  timeMin: new Date("2026-06-29T00:00:00.000Z"),
  timeMax: new Date("2026-07-06T00:00:00.000Z"),
};

function event(overrides: Partial<CalendarEventSummary> = {}): CalendarEventSummary {
  return {
    providerEventId: overrides.providerEventId ?? "evt-1",
    calendarId: overrides.calendarId ?? "primary",
    title: overrides.title ?? "Coffee with Maya",
    start: overrides.start ?? new Date("2026-06-30T15:00:00.000Z"),
    end: overrides.end ?? new Date("2026-06-30T15:30:00.000Z"),
    allDay: overrides.allDay ?? false,
    status: overrides.status ?? "confirmed",
    attendees: overrides.attendees ?? [],
    location: overrides.location ?? null,
    description: overrides.description ?? null,
    updatedAt: overrides.updatedAt ?? null,
  };
}

/** Mutable clock for deterministic TTL/staleness tests. */
function clock(startMs: number) {
  let nowMs = startMs;
  return { now: () => nowMs, advance: (ms: number) => (nowMs += ms) };
}

describe("createCalendarReader", () => {
  it("reads live on a cache miss, returns minimized summaries, and caches them", async () => {
    const adapter = createFakeCalendarAdapter([event()]);
    const cacheStore = createInMemoryCalendarCacheStore();
    const reader = createCalendarReader({ adapter, cacheStore, now: () => 1_000 });

    const result = await reader.readCalendarEvents({ ...CONNECTION, ...WINDOW });

    expect(result.source).toBe("live");
    expect(result.stale).toBe(false);
    expect(result.events).toHaveLength(1);
    expect(adapter.calls).toHaveLength(1);
    // Adapter received the resolved primary calendar + bounded window.
    expect(adapter.calls[0]?.calendarId).toBe("primary");
    expect(cacheStore.entries()).toHaveLength(1);
  });

  it("serves a fresh cache hit without calling the provider", async () => {
    const adapter = createFakeCalendarAdapter([event()]);
    const cacheStore = createInMemoryCalendarCacheStore();
    const time = clock(1_000);
    const reader = createCalendarReader({ adapter, cacheStore, now: time.now });

    await reader.readCalendarEvents({ ...CONNECTION, ...WINDOW });
    time.advance(DEFAULT_CALENDAR_TTL_MS - 1);
    const second = await reader.readCalendarEvents({ ...CONNECTION, ...WINDOW });

    expect(second.source).toBe("cache");
    expect(second.stale).toBe(false);
    expect(adapter.calls).toHaveLength(1); // not called again
  });

  it("re-reads live once the cache entry has expired", async () => {
    const adapter = createFakeCalendarAdapter([event()]);
    const cacheStore = createInMemoryCalendarCacheStore();
    const time = clock(1_000);
    const reader = createCalendarReader({ adapter, cacheStore, now: time.now });

    await reader.readCalendarEvents({ ...CONNECTION, ...WINDOW });
    time.advance(DEFAULT_CALENDAR_TTL_MS + 1);
    const second = await reader.readCalendarEvents({ ...CONNECTION, ...WINDOW });

    expect(second.source).toBe("live");
    expect(adapter.calls).toHaveLength(2);
  });

  it("serves an expired-but-fresh-enough cache as stale when the live read fails", async () => {
    const cacheStore = createInMemoryCalendarCacheStore();
    const time = clock(1_000);
    const ok = createCalendarReader({
      adapter: createFakeCalendarAdapter([event()]),
      cacheStore,
      now: time.now,
    });
    await ok.readCalendarEvents({ ...CONNECTION, ...WINDOW });

    time.advance(DEFAULT_CALENDAR_TTL_MS + 1);
    const failing = createCalendarReader({
      adapter: createFailingCalendarAdapter(),
      cacheStore,
      now: time.now,
    });
    const result = await failing.readCalendarEvents({ ...CONNECTION, ...WINDOW });

    expect(result.source).toBe("cache");
    expect(result.stale).toBe(true);
    expect(result.events).toHaveLength(1);
  });

  it("throws when the live read fails and no fresh-enough cache exists", async () => {
    const reader = createCalendarReader({
      adapter: createFailingCalendarAdapter(),
      cacheStore: createInMemoryCalendarCacheStore(),
      now: () => 1_000,
    });

    await expect(reader.readCalendarEvents({ ...CONNECTION, ...WINDOW })).rejects.toBeInstanceOf(
      CalendarUnavailableError,
    );
  });

  it("does not serve stale cache after an authorization failure", async () => {
    const cacheStore = createInMemoryCalendarCacheStore();
    const time = clock(1_000);
    const ok = createCalendarReader({
      adapter: createFakeCalendarAdapter([event()]),
      cacheStore,
      now: time.now,
    });
    await ok.readCalendarEvents({ ...CONNECTION, ...WINDOW });

    time.advance(DEFAULT_CALENDAR_TTL_MS + 1);
    const failing = createCalendarReader({
      adapter: {
        listEvents: async () => {
          throw new CalendarAuthorizationError("token");
        },
      },
      cacheStore,
      now: time.now,
    });

    await expect(failing.readCalendarEvents({ ...CONNECTION, ...WINDOW })).rejects.toMatchObject({
      name: "CalendarUnavailableError",
      cause: { name: "CalendarAuthorizationError", kind: "token" },
    });
  });

  it("keys the cache by owner, connection, calendar id, and window shape", async () => {
    const adapter = createFakeCalendarAdapter([event()]);
    const cacheStore = createInMemoryCalendarCacheStore();
    const reader = createCalendarReader({ adapter, cacheStore, now: () => 1_000 });

    await reader.readCalendarEvents({ ...CONNECTION, ...WINDOW });
    // A different owner does not see the first owner's cached window.
    await reader.readCalendarEvents({ ...CONNECTION, ownerUserId: "owner-2", ...WINDOW });
    // A different calendar id is a distinct cache entry.
    await reader.readCalendarEvents({ ...CONNECTION, calendarId: "team@group", ...WINDOW });

    expect(adapter.calls).toHaveLength(3);
    expect(cacheStore.entries()).toHaveLength(3);
  });

  it("retains no raw provider fields and caps results at the window maxResults", async () => {
    // Adapter leaks an extra raw field and returns more events than requested.
    const leaky = [
      { ...event({ providerEventId: "a" }), rawPayload: { secret: "dump" } },
      { ...event({ providerEventId: "b" }), rawPayload: { secret: "dump" } },
      { ...event({ providerEventId: "c" }), rawPayload: { secret: "dump" } },
    ] as unknown as CalendarEventSummary[];
    const cacheStore = createInMemoryCalendarCacheStore();
    const reader = createCalendarReader({
      adapter: createFakeCalendarAdapter(leaky),
      cacheStore,
      now: () => 1_000,
    });

    const result = await reader.readCalendarEvents({ ...CONNECTION, ...WINDOW, maxResults: 2 });

    expect(result.events).toHaveLength(2);
    for (const stored of cacheStore.entries()[0]?.events ?? []) {
      expect(Object.keys(stored)).not.toContain("rawPayload");
    }
  });

  it("clears all cached windows for an owner connection (disconnect support)", async () => {
    const adapter = createFakeCalendarAdapter([event()]);
    const cacheStore = createInMemoryCalendarCacheStore();
    const reader = createCalendarReader({ adapter, cacheStore, now: () => 1_000 });

    await reader.readCalendarEvents({ ...CONNECTION, ...WINDOW });
    await reader.readCalendarEvents({ ...CONNECTION, calendarId: "team@group", ...WINDOW });
    expect(cacheStore.entries()).toHaveLength(2);

    const cleared = await cacheStore.clearConnection(CONNECTION);
    expect(cleared).toBe(2);
    expect(cacheStore.entries()).toHaveLength(0);
  });

  it("prunes a connection's dead windows after a live read so the cache stays bounded", async () => {
    // A long-dead window from an earlier `now`, past the stale-fallback horizon.
    const cacheStore = createInMemoryCalendarCacheStore([
      cacheEntry({
        windowKey: "ancient",
        fetchedAt: new Date(NOW_MS - DEFAULT_CALENDAR_STALE_MAX_MS - 1),
      }),
    ]);
    const adapter = createFakeCalendarAdapter([event()]);
    const reader = createCalendarReader({ adapter, cacheStore, now: () => NOW_MS });

    await reader.readCalendarEvents({ ...CONNECTION, ...WINDOW });

    // The dead window is gone; only the just-written fresh window remains, so a
    // moving window key cannot grow the cache without bound.
    const keys = cacheStore.entries().map((entry) => entry.windowKey);
    expect(keys).not.toContain("ancient");
    expect(cacheStore.entries()).toHaveLength(1);
  });
});

const NOW_MS = 1_000_000_000;

/** A minimal cache entry for the given connection, for eviction assertions. */
function cacheEntry(input: {
  windowKey: string;
  fetchedAt: Date;
  calendarId?: string;
  ownerUserId?: string;
}): CalendarCacheEntry {
  return {
    ...CONNECTION,
    ownerUserId: input.ownerUserId ?? CONNECTION.ownerUserId,
    calendarId: input.calendarId ?? "primary",
    windowKey: input.windowKey,
    events: [],
    fetchedAt: input.fetchedAt,
    expiresAt: new Date(input.fetchedAt.getTime() + DEFAULT_CALENDAR_TTL_MS),
  };
}

describe("calendar cache eviction", () => {
  it("evicts rows past the stale-fallback horizon and keeps serviceable ones", async () => {
    const now = new Date(NOW_MS);
    const store = createInMemoryCalendarCacheStore([
      cacheEntry({
        windowKey: "dead",
        fetchedAt: new Date(NOW_MS - DEFAULT_CALENDAR_STALE_MAX_MS - 1),
      }),
      cacheEntry({ windowKey: "serviceable", fetchedAt: new Date(NOW_MS - 1_000) }),
    ]);

    const evicted = await store.evictExpired({
      ref: CONNECTION,
      now,
      staleMaxMs: DEFAULT_CALENDAR_STALE_MAX_MS,
    });

    expect(evicted).toBe(1);
    expect(store.entries().map((entry) => entry.windowKey)).toEqual(["serviceable"]);
  });

  it("evicts only the given connection's rows", async () => {
    const now = new Date(NOW_MS);
    const dead = new Date(NOW_MS - DEFAULT_CALENDAR_STALE_MAX_MS - 1);
    const store = createInMemoryCalendarCacheStore([
      cacheEntry({ windowKey: "mine", fetchedAt: dead }),
      cacheEntry({ windowKey: "theirs", fetchedAt: dead, ownerUserId: "owner-2" }),
    ]);

    const evicted = await store.evictExpired({
      ref: CONNECTION,
      now,
      staleMaxMs: DEFAULT_CALENDAR_STALE_MAX_MS,
    });

    expect(evicted).toBe(1);
    expect(store.entries().map((entry) => entry.ownerUserId)).toEqual(["owner-2"]);
  });
});
