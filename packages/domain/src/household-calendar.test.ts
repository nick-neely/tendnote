import { describe, expect, it } from "vitest";
import type { CalendarEventSummary, CalendarReadResult } from "./calendar";
import {
  assertHouseholdCalendarConnectAllowed,
  assertHouseholdCalendarDisconnectAllowed,
  canReadHouseholdCalendars,
  findHouseholdCalendarEvent,
  HOUSEHOLD_CALENDAR_CONNECTION_LIMIT,
  type HouseholdCalendarConnectionSummary,
  householdCalendarConnectRefusal,
  householdCalendarEventKey,
  householdCalendarFamilyFromResult,
} from "./household-calendar";
import { HouseholdValidationError } from "./household-policy";

const HOUSEHOLD = "household-1";
const OWNER = { role: "owner", status: "active" } as const;
const MEMBER = { role: "member", status: "active" } as const;

function connectInput(overrides: Partial<Parameters<typeof householdCalendarConnectRefusal>[0]>) {
  return {
    actor: OWNER,
    connectedCount: 0,
    connectorHasCalendarAccess: true,
    ...overrides,
  };
}

describe("household calendar governance", () => {
  it("lets an active owner designate a calendar", () => {
    expect(householdCalendarConnectRefusal(connectInput({}))).toBeNull();
    expect(() => assertHouseholdCalendarConnectAllowed(connectInput({}))).not.toThrow();
  });

  it("refuses a member, because designating changes what everyone can read", () => {
    expect(householdCalendarConnectRefusal(connectInput({ actor: MEMBER }))).toMatch(
      /only a household owner/i,
    );
  });

  it("refuses an owner who has been removed", () => {
    const refusal = householdCalendarConnectRefusal(
      connectInput({ actor: { role: "owner", status: "removed" } }),
    );
    expect(refusal).toMatch(/only a household owner/i);
  });

  it("refuses when the connector has no calendar access of their own to share", () => {
    expect(
      householdCalendarConnectRefusal(connectInput({ connectorHasCalendarAccess: false })),
    ).toMatch(/connect your own google calendar/i);
  });

  it("refuses a duplicate designation of the same calendar", () => {
    expect(householdCalendarConnectRefusal(connectInput({ alreadyConnected: true }))).toMatch(
      /already shared/i,
    );
  });

  it("refuses past the connection limit", () => {
    expect(
      householdCalendarConnectRefusal(
        connectInput({ connectedCount: HOUSEHOLD_CALENDAR_CONNECTION_LIMIT }),
      ),
    ).toMatch(/disconnect one/i);
  });

  it("throws the same sentence the disabled control would show", () => {
    const input = connectInput({ actor: MEMBER });
    expect(() => assertHouseholdCalendarConnectAllowed(input)).toThrow(HouseholdValidationError);
    try {
      assertHouseholdCalendarConnectAllowed(input);
    } catch (error) {
      expect((error as Error).message).toBe(householdCalendarConnectRefusal(input));
    }
  });

  it("keeps disconnect an owner decision too", () => {
    expect(() => assertHouseholdCalendarDisconnectAllowed({ actor: OWNER })).not.toThrow();
    expect(() => assertHouseholdCalendarDisconnectAllowed({ actor: MEMBER })).toThrow(
      HouseholdValidationError,
    );
  });
});

describe("who may read a designated calendar", () => {
  const memberships = [
    { householdId: HOUSEHOLD, userId: "ana" },
    { householdId: HOUSEHOLD, userId: "ben" },
  ];

  it("admits any active member, connector or not", () => {
    for (const userId of ["ana", "ben"]) {
      expect(
        canReadHouseholdCalendars({
          callerUserId: userId,
          householdId: HOUSEHOLD,
          callerActiveMemberships: memberships.filter((m) => m.userId === userId),
        }),
      ).toBe(true);
    }
  });

  it("refuses someone with no active membership here", () => {
    expect(
      canReadHouseholdCalendars({
        callerUserId: "cai",
        householdId: HOUSEHOLD,
        callerActiveMemberships: [],
      }),
    ).toBe(false);
  });

  it("refuses an active member of a different household", () => {
    expect(
      canReadHouseholdCalendars({
        callerUserId: "cai",
        householdId: HOUSEHOLD,
        callerActiveMemberships: [{ householdId: "household-2", userId: "cai" }],
      }),
    ).toBe(false);
  });

  it("refuses an empty caller", () => {
    expect(
      canReadHouseholdCalendars({
        callerUserId: "",
        householdId: HOUSEHOLD,
        callerActiveMemberships: memberships,
      }),
    ).toBe(false);
  });
});

const CONNECTION: HouseholdCalendarConnectionSummary = {
  id: "connection-1",
  label: "Family",
  calendarId: "primary",
  connectorUserId: "ana",
  designatedByUserId: "ana",
  connectedAt: new Date("2026-08-01T00:00:00Z"),
};

function event(providerEventId: string): CalendarEventSummary {
  return {
    providerEventId,
    calendarId: "primary",
    title: "School concert",
    start: new Date("2026-08-10T18:00:00Z"),
    end: new Date("2026-08-10T19:00:00Z"),
    allDay: false,
    status: "confirmed",
    attendees: [],
    location: null,
    description: null,
    updatedAt: null,
  };
}

function readResult(overrides: Partial<CalendarReadResult> = {}): CalendarReadResult {
  return {
    events: [event("event-1")],
    source: "live",
    stale: false,
    fetchedAt: new Date("2026-08-08T12:00:00Z"),
    expiresAt: new Date("2026-08-08T12:05:00Z"),
    ...overrides,
  };
}

describe("read-through families", () => {
  it("carries the events and their freshness", () => {
    const family = householdCalendarFamilyFromResult({
      connection: CONNECTION,
      result: readResult(),
    });
    expect(family).toMatchObject({
      connectionId: "connection-1",
      label: "Family",
      state: "events",
      stale: false,
    });
  });

  it("marks a stale-cache fallback as stale rather than hiding it", () => {
    const family = householdCalendarFamilyFromResult({
      connection: CONNECTION,
      result: readResult({ source: "cache", stale: true }),
    });
    expect(family).toMatchObject({ state: "events", stale: true });
  });

  it("collapses every way a read can fail into one unavailable outcome", () => {
    const family = householdCalendarFamilyFromResult({ connection: CONNECTION, result: null });
    expect(family).toEqual({ connectionId: "connection-1", label: "Family", state: "unavailable" });
    expect(family).not.toHaveProperty("events");
  });
});

describe("event references", () => {
  const read = {
    families: [
      householdCalendarFamilyFromResult({ connection: CONNECTION, result: readResult() }),
      householdCalendarFamilyFromResult({
        connection: { ...CONNECTION, id: "connection-2", label: "Sports" },
        result: null,
      }),
    ],
  };

  it("keys on all three parts, since a provider id is only unique in its calendar", () => {
    expect(
      householdCalendarEventKey({
        connectionId: "connection-1",
        calendarId: "primary",
        providerEventId: "event-1",
      }),
    ).not.toBe(
      householdCalendarEventKey({
        connectionId: "connection-2",
        calendarId: "primary",
        providerEventId: "event-1",
      }),
    );
  });

  it("finds a referenced event inside a readable family", () => {
    expect(
      findHouseholdCalendarEvent(read, {
        connectionId: "connection-1",
        calendarId: "primary",
        providerEventId: "event-1",
      }),
    ).toMatchObject({ providerEventId: "event-1" });
  });

  it("returns null for a reference into an unavailable family", () => {
    expect(
      findHouseholdCalendarEvent(read, {
        connectionId: "connection-2",
        calendarId: "primary",
        providerEventId: "event-1",
      }),
    ).toBeNull();
  });

  it("does not let one unavailable family hide a readable one", () => {
    expect(read.families.filter((family) => family.state === "events")).toHaveLength(1);
    expect(read.families).toHaveLength(2);
  });
});
