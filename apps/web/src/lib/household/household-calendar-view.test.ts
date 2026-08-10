import type { CalendarEventSummary } from "@tendnote/domain";
import {
  type HouseholdCalendarRead,
  householdCalendarEventKey,
} from "@tendnote/domain/household-calendar";
import { describe, expect, it } from "vitest";
import {
  buildHouseholdCalendarFamilyViews,
  HOUSEHOLD_CALENDAR_FAMILY_EVENT_LIMIT,
  hasUnavailableHouseholdCalendar,
} from "./household-calendar-view";

const NOW = new Date("2026-08-09T09:00:00Z");

function event(overrides: Partial<CalendarEventSummary> = {}): CalendarEventSummary {
  return {
    providerEventId: "event-1",
    calendarId: "primary",
    title: "School concert",
    start: new Date("2026-08-11T18:30:00Z"),
    end: new Date("2026-08-11T20:00:00Z"),
    allDay: false,
    status: "confirmed",
    attendees: [],
    location: null,
    description: null,
    updatedAt: null,
    ...overrides,
  };
}

function read(families: HouseholdCalendarRead["families"]): HouseholdCalendarRead {
  return { families };
}

describe("buildHouseholdCalendarFamilyViews", () => {
  it("formats one designated calendar's events the way the personal preview does", () => {
    const [family] = buildHouseholdCalendarFamilyViews({
      now: NOW,
      read: read([
        {
          connectionId: "connection-1",
          label: "Family calendar",
          state: "events",
          stale: false,
          fetchedAt: NOW,
          events: [
            event({
              attendees: [
                { email: "ana@example.com", displayName: "Ana Reyes", self: false } as never,
                { email: "ben@example.com", displayName: "Ben Reyes", self: false } as never,
              ],
            }),
          ],
        },
      ]),
    });

    expect(family).toMatchObject({
      connectionId: "connection-1",
      label: "Family calendar",
      state: "events",
      stale: false,
      cachedLabel: null,
    });
    expect(family?.state === "events" && family.events[0]).toMatchObject({
      title: "School concert",
      whenLabel: "Tue 6:30 PM",
      withWhom: "with Ana +1",
      cancelled: false,
      planned: false,
    });
  });

  /**
   * The one thing the Phase Eight contract insists on: a calendar that cannot be
   * read says so on its own card, and the one beside it is untouched.
   */
  it("keeps a failing calendar from taking a working one with it", () => {
    const families = buildHouseholdCalendarFamilyViews({
      now: NOW,
      read: read([
        { connectionId: "connection-1", label: "Family calendar", state: "unavailable" },
        {
          connectionId: "connection-2",
          label: "School calendar",
          state: "events",
          stale: false,
          fetchedAt: NOW,
          events: [event({ providerEventId: "event-2", calendarId: "school" })],
        },
      ]),
    });

    expect(families[0]).toEqual({
      connectionId: "connection-1",
      label: "Family calendar",
      // Unattributed here because this call supplies no sharer names; the
      // attribution case is covered on its own below.
      sharedBy: null,
      state: "unavailable",
    });
    expect(families[1]?.state).toBe("events");
    expect(hasUnavailableHouseholdCalendar(families)).toBe(true);
  });

  it("names who shared a calendar, and leaves it unattributed when nobody is named", () => {
    const families = buildHouseholdCalendarFamilyViews({
      now: NOW,
      read: read([
        { connectionId: "connection-1", label: "Family calendar", state: "unavailable" },
        {
          connectionId: "connection-2",
          label: "School calendar",
          state: "events",
          stale: false,
          fetchedAt: NOW,
          events: [event({ providerEventId: "event-2", calendarId: "school" })],
        },
      ]),
      sharedByNames: new Map([["connection-2", "Ana"]]),
    });

    // Attribution rides the connection, not the read outcome: an unreadable
    // calendar the household can still see the sharer of is the case where
    // knowing who to ask matters most.
    expect(families[0]?.sharedBy).toBeNull();
    expect(families[1]?.sharedBy).toBe("Ana");
  });

  /** A stale family says so, and says how old what it is showing is. */
  it("marks a family served from cache with how long ago it was read", () => {
    const [family] = buildHouseholdCalendarFamilyViews({
      now: NOW,
      read: read([
        {
          connectionId: "connection-1",
          label: "Family calendar",
          state: "events",
          stale: true,
          fetchedAt: new Date("2026-08-09T06:00:00Z"),
          events: [event()],
        },
      ]),
    });

    expect(family).toMatchObject({ state: "events", stale: true, cachedLabel: "3h ago" });
  });

  it("says a designated calendar is simply empty rather than broken", () => {
    const [family] = buildHouseholdCalendarFamilyViews({
      now: NOW,
      read: read([
        {
          connectionId: "connection-1",
          label: "Family calendar",
          state: "events",
          stale: false,
          fetchedAt: NOW,
          events: [],
        },
      ]),
    });

    expect(family).toMatchObject({ state: "empty", stale: false });
  });

  /**
   * Truncation is per calendar, so a household with three of them is answering
   * three questions rather than losing whichever sorts last.
   */
  it("shows the soonest events, in order, up to one calendar's limit", () => {
    const events = Array.from({ length: HOUSEHOLD_CALENDAR_FAMILY_EVENT_LIMIT + 2 }, (_, index) =>
      event({
        providerEventId: `event-${index}`,
        title: `Event ${index}`,
        // Deliberately handed over newest first, to prove the order is ours.
        start: new Date(2026, 7, 20 - index, 12),
      }),
    );
    const [family] = buildHouseholdCalendarFamilyViews({
      now: NOW,
      read: read([
        {
          connectionId: "connection-1",
          label: "Family calendar",
          state: "events",
          stale: false,
          fetchedAt: NOW,
          events,
        },
      ]),
    });

    const shown = family?.state === "events" ? family.events : [];
    expect(shown).toHaveLength(HOUSEHOLD_CALENDAR_FAMILY_EVENT_LIMIT);
    expect(shown.map((row) => row.title)).toEqual(["Event 5", "Event 4", "Event 3", "Event 2"]);
  });

  /** Google owns cancellation. Tendnote reports it as text, never as a colour. */
  it("reports the provider's own cancellation", () => {
    const [family] = buildHouseholdCalendarFamilyViews({
      now: NOW,
      read: read([
        {
          connectionId: "connection-1",
          label: "Family calendar",
          state: "events",
          stale: false,
          fetchedAt: NOW,
          events: [event({ status: "cancelled", title: null })],
        },
      ]),
    });

    expect(family?.state === "events" && family.events[0]).toMatchObject({
      title: "Untitled event",
      cancelled: true,
    });
  });

  it("marks an event this household already has a plan for", () => {
    const [family] = buildHouseholdCalendarFamilyViews({
      now: NOW,
      plannedEventKeys: new Set([
        householdCalendarEventKey({
          connectionId: "connection-1",
          calendarId: "primary",
          providerEventId: "event-1",
        }),
      ]),
      read: read([
        {
          connectionId: "connection-1",
          label: "Family calendar",
          state: "events",
          stale: false,
          fetchedAt: NOW,
          events: [event(), event({ providerEventId: "event-9" })],
        },
      ]),
    });

    const shown = family?.state === "events" ? family.events : [];
    expect(shown.map((row) => row.planned)).toEqual([true, false]);
  });
});
