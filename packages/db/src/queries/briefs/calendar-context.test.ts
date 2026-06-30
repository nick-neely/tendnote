import type { CalendarEventSummary } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { createDefaultGoogleCalendarReader } from "../calendar";
import { createFailingCalendarAdapter, createFakeCalendarAdapter } from "../calendar/fake-adapter";
import { createInMemoryCalendarCacheStore } from "../calendar/in-memory-store";
import { createCalendarReader } from "../calendar/reader";
import {
  type BriefCalendarContextProvider,
  createCalendarBriefContextProvider,
  mapCalendarHighlights,
} from "./calendar-context";
import { createBriefGenerator } from "./generator";
import { createInMemoryBriefStore } from "./in-memory-store";

function event(overrides: Partial<CalendarEventSummary> = {}): CalendarEventSummary {
  return {
    providerEventId: overrides.providerEventId ?? "evt-1",
    calendarId: "primary",
    title: overrides.title ?? "Coffee with Maya",
    start: overrides.start ?? new Date("2026-06-27T15:00:00.000Z"),
    end: overrides.end ?? new Date("2026-06-27T15:30:00.000Z"),
    allDay: overrides.allDay ?? false,
    status: "confirmed",
    attendees: overrides.attendees ?? [],
    location: overrides.location ?? null,
    description: overrides.description ?? "secret raw description",
    updatedAt: null,
  };
}

const WINDOW = {
  ownerUserId: "owner-1",
  windowStart: new Date("2026-06-27T00:00:00.000Z"),
  windowEnd: new Date("2026-06-28T00:00:00.000Z"),
  limit: 4,
};

function readerWith(events: CalendarEventSummary[]) {
  return createCalendarReader({
    adapter: createFakeCalendarAdapter(events),
    cacheStore: createInMemoryCalendarCacheStore(),
    now: () => 1000,
  });
}

describe("mapCalendarHighlights", () => {
  it("minimizes events to title/start/allDay + provider-derived reason, dropping raw fields", () => {
    const highlights = mapCalendarHighlights(
      [
        event({
          attendees: [
            {
              email: "me@x.com",
              displayName: "Me",
              responseStatus: null,
              self: true,
              organizer: true,
            },
            {
              email: "maya@x.com",
              displayName: "Maya Chen",
              responseStatus: null,
              self: false,
              organizer: false,
            },
          ],
        }),
      ],
      4,
    );

    expect(highlights[0]).toEqual({
      title: "Coffee with Maya",
      start: new Date("2026-06-27T15:00:00.000Z"),
      allDay: false,
      reason: "On your calendar, with Maya",
    });
    // No raw payload fields survive.
    expect(Object.keys(highlights[0] ?? {})).not.toContain("description");
  });
});

describe("createCalendarBriefContextProvider", () => {
  it("returns highlights when connected", async () => {
    const provider = createCalendarBriefContextProvider({
      readerFor: () => readerWith([event()]),
      isConnected: async () => true,
    });
    await expect(provider(WINDOW)).resolves.toHaveLength(1);
  });

  it("returns no highlights when the calendar is disconnected", async () => {
    const provider = createCalendarBriefContextProvider({
      readerFor: () => readerWith([event()]),
      isConnected: async () => false,
    });
    await expect(provider(WINDOW)).resolves.toEqual([]);
  });

  it("returns no highlights when the read is unavailable", async () => {
    const provider = createCalendarBriefContextProvider({
      readerFor: () =>
        createCalendarReader({
          adapter: createFailingCalendarAdapter(),
          cacheStore: createInMemoryCalendarCacheStore(),
          now: () => 1000,
        }),
      isConnected: async () => true,
    });
    await expect(provider(WINDOW)).resolves.toEqual([]);
  });

  it("still includes highlights when the read falls back to stale cache", async () => {
    // A reader that serves an expired-but-fresh-enough cache as stale (ADR-0081).
    const staleResult = {
      events: [event({ title: "Standup" })],
      source: "cache" as const,
      stale: true,
      fetchedAt: new Date("2026-06-27T11:00:00.000Z"),
      expiresAt: new Date("2026-06-27T11:05:00.000Z"),
    };
    const provider = createCalendarBriefContextProvider({
      readerFor: () => ({ readCalendarEvents: async () => staleResult }),
      isConnected: async () => true,
    });

    const highlights = await provider(WINDOW);
    expect(highlights).toHaveLength(1);
    expect(highlights[0]?.title).toBe("Standup");
  });

  it("can populate brief highlights from a live cache-miss read", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id: "evt-live",
            summary: "Live standup",
            start: { dateTime: "2026-06-27T15:00:00.000Z" },
            end: { dateTime: "2026-06-27T15:30:00.000Z" },
            attendees: [{ email: "maya@example.com", displayName: "Maya", self: false }],
          },
        ],
      }),
      text: async () => "",
    } as Response);
    const provider = createCalendarBriefContextProvider({
      readerFor: () =>
        createDefaultGoogleCalendarReader({
          cacheStore: createInMemoryCalendarCacheStore(),
          getAccessToken: async () => "brief-token",
          now: () => 1000,
        }),
      isConnected: async () => true,
    });

    const highlights = await provider(WINDOW);

    expect(highlights).toEqual([
      {
        title: "Live standup",
        start: new Date("2026-06-27T15:00:00.000Z"),
        allDay: false,
        reason: "On your calendar, with Maya",
      },
    ]);
    fetchSpy.mockRestore();
  });
});

describe("brief generator with Calendar context (#112)", () => {
  const LOCAL_DATE = "2026-06-27";
  const emptyAgenda = { getRelationshipAgenda: async () => [] };

  async function generateWith(calendarContext?: BriefCalendarContextProvider) {
    const store = createInMemoryBriefStore();
    const generator = createBriefGenerator(store, emptyAgenda, { calendarContext });
    return generator.generateBrief({
      ownerUserId: "owner-1",
      cadence: "daily",
      localDate: LOCAL_DATE,
    });
  }

  it("appends provider-derived calendar items marked logged_context, with no person/source", async () => {
    const provider: BriefCalendarContextProvider = async () => [
      {
        title: "Standup",
        start: new Date(`${LOCAL_DATE}T09:00:00.000Z`),
        allDay: false,
        reason: "On your calendar",
      },
    ];
    const brief = await generateWith(provider);

    const calendarItems = brief.items.filter((item) => item.kind === "calendar_event");
    expect(calendarItems).toHaveLength(1);
    expect(calendarItems[0]).toMatchObject({
      kind: "calendar_event",
      trustLevel: "logged_context",
      personId: null,
      title: "Standup",
    });
    expect(calendarItems[0]?.sourceRefs).toEqual([]);
  });

  it("caps calendar items to the daily calendar cap (2)", async () => {
    const provider: BriefCalendarContextProvider = async () =>
      Array.from({ length: 6 }, (_, i) => ({
        title: `Event ${i}`,
        start: new Date(`${LOCAL_DATE}T0${i}:00:00.000Z`),
        allDay: false,
        reason: "On your calendar",
      }));
    const brief = await generateWith(provider);
    expect(brief.items.filter((item) => item.kind === "calendar_event")).toHaveLength(2);
  });

  it("degrades gracefully: a throwing provider yields a brief with no calendar items", async () => {
    const provider: BriefCalendarContextProvider = async () => {
      throw new Error("calendar unavailable");
    };
    const brief = await generateWith(provider);
    expect(brief.items.filter((item) => item.kind === "calendar_event")).toEqual([]);
  });

  it("creates a normal brief when no calendar provider is wired", async () => {
    const brief = await generateWith(undefined);
    expect(brief.items.filter((item) => item.kind === "calendar_event")).toEqual([]);
  });
});
