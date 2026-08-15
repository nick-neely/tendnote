import type { CalendarEventSummary, CalendarReadResult } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import {
  buildCalendarPreviewView,
  CALENDAR_PREVIEW_MAX_EVENTS,
  cachedAgoLabel,
  formatEventWhen,
  parseCalendarPreviewTarget,
  previewAttendeeSummary,
} from "./calendar-preview";

const NOW = new Date("2026-06-30T12:00:00.000Z");

function summary(overrides: Partial<CalendarEventSummary> = {}): CalendarEventSummary {
  return {
    providerEventId: overrides.providerEventId ?? "evt-1",
    calendarId: "primary",
    title: overrides.title ?? "Coffee with Maya",
    start: overrides.start ?? new Date("2026-06-30T15:30:00.000Z"),
    end: overrides.end ?? new Date("2026-06-30T16:00:00.000Z"),
    allDay: overrides.allDay ?? false,
    status: "confirmed",
    attendees: overrides.attendees ?? [],
    location: null,
    description: null,
    updatedAt: null,
  };
}

function result(overrides: Partial<CalendarReadResult>): CalendarReadResult {
  return {
    events: overrides.events ?? [],
    source: overrides.source ?? "live",
    stale: overrides.stale ?? false,
    fetchedAt: overrides.fetchedAt ?? NOW,
    expiresAt: overrides.expiresAt ?? new Date(NOW.getTime() + 300_000),
  };
}

describe("formatEventWhen", () => {
  it("formats timed and all-day events", () => {
    expect(formatEventWhen(new Date("2026-06-30T15:30:00.000Z"), false, "UTC")).toBe("Tue 3:30 PM");
    expect(formatEventWhen(new Date("2026-06-30T00:00:00.000Z"), true, "UTC")).toBe(
      "Tue · all day",
    );
  });
});

describe("previewAttendeeSummary", () => {
  it("excludes self and summarizes the rest by first name + overflow", () => {
    expect(
      previewAttendeeSummary([
        { email: "me@x.com", displayName: "Me", responseStatus: null, self: true, organizer: true },
        {
          email: "maya@x.com",
          displayName: "Maya Chen",
          responseStatus: null,
          self: false,
          organizer: false,
        },
        {
          email: "sam@x.com",
          displayName: "Sam",
          responseStatus: null,
          self: false,
          organizer: false,
        },
      ]),
    ).toBe("with Maya +1");
  });

  it("returns null when the owner is the only attendee", () => {
    expect(
      previewAttendeeSummary([
        { email: "me@x.com", displayName: "Me", responseStatus: null, self: true, organizer: true },
      ]),
    ).toBeNull();
  });
});

describe("cachedAgoLabel", () => {
  it("renders whole-unit relative ages", () => {
    expect(cachedAgoLabel(new Date(NOW.getTime() - 90_000), NOW)).toBe("1m ago");
    expect(cachedAgoLabel(new Date(NOW.getTime() - 2 * 3_600_000), NOW)).toBe("2h ago");
  });
});

describe("buildCalendarPreviewView", () => {
  it("hides the preview entirely when Calendar is not connected", () => {
    expect(buildCalendarPreviewView({ connected: false, result: null, now: NOW })).toEqual({
      state: "hidden",
    });
  });

  it("shows an unavailable state when connected but the read failed with no cache", () => {
    expect(buildCalendarPreviewView({ connected: true, result: null, now: NOW })).toEqual({
      state: "unavailable",
    });
  });

  it("shows a reconnect state when the provider authorization must be renewed", () => {
    expect(
      buildCalendarPreviewView({
        connected: true,
        result: null,
        requiresReauthorization: true,
        now: NOW,
      }),
    ).toEqual({ state: "needs_reconnect" });
  });

  it("shows a calm empty state when connected with no events", () => {
    const view = buildCalendarPreviewView({
      connected: true,
      result: result({ events: [] }),
      now: NOW,
    });
    expect(view).toEqual({ state: "empty", stale: false, cachedLabel: null });
  });

  it("renders bounded minimized events and caps the count", () => {
    const events = Array.from({ length: 10 }, (_, i) => summary({ providerEventId: `e${i}` }));
    const view = buildCalendarPreviewView({
      connected: true,
      result: result({ events }),
      now: NOW,
      timeZone: "UTC",
    });

    expect(view.state).toBe("events");
    if (view.state !== "events") return;
    expect(view.events.length).toBe(CALENDAR_PREVIEW_MAX_EVENTS);
    expect(view.events[0]).toMatchObject({
      id: "primary:e0",
      title: "Coffee with Maya",
      whenLabel: "Tue 3:30 PM",
    });
    expect(view.stale).toBe(false);
  });

  it("promotes a specifically requested event into the bounded preview", () => {
    const events = Array.from({ length: 6 }, (_, i) => summary({ providerEventId: `e${i}` }));
    const view = buildCalendarPreviewView({
      connected: true,
      result: result({ events }),
      now: NOW,
      targetEventId: "primary:e5",
    });

    expect(view.state).toBe("events");
    if (view.state !== "events") return;
    expect(view.events[0]?.id).toBe("primary:e5");
  });

  it("can be empty and stale at once (cached, fresh-enough, but no events)", () => {
    const view = buildCalendarPreviewView({
      connected: true,
      result: result({
        events: [],
        source: "cache",
        stale: true,
        fetchedAt: new Date(NOW.getTime() - 30 * 60_000),
      }),
      now: NOW,
    });
    expect(view).toEqual({ state: "empty", stale: true, cachedLabel: "30m ago" });
  });

  it("marks events stale with a cached-age label when an expired cache was served", () => {
    const view = buildCalendarPreviewView({
      connected: true,
      result: result({
        events: [summary()],
        source: "cache",
        stale: true,
        fetchedAt: new Date(NOW.getTime() - 2 * 3_600_000),
      }),
      now: NOW,
    });

    expect(view.state).toBe("events");
    if (view.state !== "events") return;
    expect(view.stale).toBe(true);
    expect(view.cachedLabel).toBe("2h ago");
  });
});

describe("parseCalendarPreviewTarget", () => {
  it("accepts one bounded canonical event target and rejects incomplete input", () => {
    expect(
      parseCalendarPreviewTarget({
        calendarId: "primary",
        calendarEvent: "event-1",
        calendarStart: "2026-07-23T15:00:00.000Z",
        calendarQuery: "Filter meeting",
      }),
    ).toEqual({
      calendarId: "primary",
      providerEventId: "event-1",
      start: new Date("2026-07-23T15:00:00.000Z"),
      query: "Filter meeting",
    });
    expect(parseCalendarPreviewTarget({ calendarId: "primary" })).toBeNull();
  });
});
