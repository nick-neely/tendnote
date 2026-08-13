import { HouseholdValidationError } from "@tendnote/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  requireAdmittedOwnerForActionSpy,
  revalidatePathSpy,
  updateTagSpy,
} from "@/test/action-adapter-mocks";

const calendars = vi.hoisted(() => ({
  connectHouseholdCalendar: vi.fn(),
  disconnectHouseholdCalendar: vi.fn(),
  listHouseholdCalendarConnections: vi.fn(),
  readHouseholdCalendars: vi.fn(),
}));
vi.mock("@tendnote/db/queries/household-calendar", () => calendars);

const providers = vi.hoisted(() => ({ isProviderCapabilityConnected: vi.fn() }));
vi.mock("@tendnote/db/queries/provider-connections", () => providers);

vi.mock("@tendnote/db/queries/household-event-plans", () => ({
  listHouseholdEventPlans: vi.fn(),
}));

vi.mock("@/lib/auth/social", () => ({
  googleEnvFromProcess: () => ({}),
  isGoogleConfigured: () => true,
}));

import {
  connectHouseholdCalendarAction,
  disconnectHouseholdCalendarAction,
} from "./household-calendar";

const CONNECTION = {
  id: "connection-1",
  label: "Family calendar",
  calendarId: "primary",
  connectorUserId: "owner-1",
  designatedByUserId: "owner-1",
  connectedAt: new Date("2026-08-01T09:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmittedOwnerForActionSpy.mockResolvedValue("owner-1");
  providers.isProviderCapabilityConnected.mockResolvedValue(true);
  calendars.connectHouseholdCalendar.mockResolvedValue(CONNECTION);
  calendars.disconnectHouseholdCalendar.mockResolvedValue({ disconnected: true });
  calendars.listHouseholdCalendarConnections.mockResolvedValue([CONNECTION]);
  calendars.readHouseholdCalendars.mockResolvedValue({
    families: [
      {
        connectionId: "connection-1",
        label: "Family calendar",
        state: "events",
        events: [],
        stale: false,
        fetchedAt: new Date("2026-08-09T09:00:00Z"),
      },
    ],
  });
});

describe("connectHouseholdCalendarAction", () => {
  /**
   * Nothing in the payload names a calendar or a connector. The caller is the
   * connector, resolved from their session, and the calendar is their own
   * primary one - a request shape that could name either is a request shape that
   * could name someone else's.
   */
  it("designates the caller's own primary calendar, from the session", async () => {
    const result = await connectHouseholdCalendarAction({ label: "  Family calendar  " });

    expect(calendars.connectHouseholdCalendar).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      calendarId: "primary",
      label: "  Family calendar  ",
      connectorHasCalendarAccess: true,
    });
    expect(result.ok).toBe(true);
    expect(updateTagSpy).not.toHaveBeenCalled();
    expect(revalidatePathSpy).toHaveBeenCalledWith("/household");
    expect(revalidatePathSpy).not.toHaveBeenCalledWith("/account");
  });

  /**
   * The connector's own Google grant is a server fact. A client asserting it
   * would designate a calendar Tendnote has no way to read.
   */
  it("reads the connector's own Calendar grant server-side rather than trusting the request", async () => {
    providers.isProviderCapabilityConnected.mockResolvedValue(false);

    await connectHouseholdCalendarAction({ label: "Family calendar" });

    expect(providers.isProviderCapabilityConnected).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      providerKey: "google",
      capabilityKey: "calendar",
    });
    expect(calendars.connectHouseholdCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ connectorHasCalendarAccess: false }),
    );
  });

  it("refuses a payload that tries to name a calendar of its own", async () => {
    const result = await connectHouseholdCalendarAction({
      label: "Family calendar",
      calendarId: "someone-else@example.com",
    } as never);

    expect(result.ok).toBe(false);
    expect(calendars.connectHouseholdCalendar).not.toHaveBeenCalled();
  });

  /** A governance refusal is rendered in place, in the household's own words. */
  it("renders an owner-only refusal as data", async () => {
    calendars.connectHouseholdCalendar.mockRejectedValue(
      new HouseholdValidationError(
        "Only a household owner can share a calendar with everyone here.",
      ),
    );

    const result = await connectHouseholdCalendarAction({ label: "Family calendar" });

    expect(result).toEqual({
      ok: false,
      error: "Only a household owner can share a calendar with everyone here.",
    });
    expect(updateTagSpy).not.toHaveBeenCalled();
  });

  /**
   * The household did designate these calendars. "Nothing is shared here" would
   * be a different and untrue answer to "the read failed".
   */
  it("answers a failed read with unavailable calendars rather than an empty surface", async () => {
    calendars.readHouseholdCalendars.mockRejectedValue(new Error("provider down"));

    const result = await connectHouseholdCalendarAction({ label: "Family calendar" });

    expect(result).toEqual({
      ok: true,
      view: {
        connections: [CONNECTION],
        read: {
          families: [
            { connectionId: "connection-1", label: "Family calendar", state: "unavailable" },
          ],
        },
      },
    });
  });
});

describe("disconnectHouseholdCalendarAction", () => {
  it("stops sharing one connection and answers with the refreshed surface", async () => {
    calendars.disconnectHouseholdCalendar.mockResolvedValue({ disconnected: true });
    calendars.listHouseholdCalendarConnections.mockResolvedValue([]);
    calendars.readHouseholdCalendars.mockResolvedValue({ families: [] });

    const result = await disconnectHouseholdCalendarAction({ connectionId: "connection-1" });

    expect(calendars.disconnectHouseholdCalendar).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      connectionId: "connection-1",
    });
    expect(result).toEqual({ ok: true, view: { connections: [], read: { families: [] } } });
    expect(updateTagSpy).not.toHaveBeenCalled();
    expect(revalidatePathSpy).toHaveBeenCalledWith("/household");
  });
});
