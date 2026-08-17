import { describe, expect, it, vi } from "vitest";
import { CalendarAuthorizationError } from "./calendar/errors";
import { createGoogleCalendarAdapter } from "./calendar/google-adapter";

const CONNECTION = { ownerUserId: "owner-1", providerKey: "google", capabilityKey: "calendar" };
const WINDOW = {
  calendarId: "primary",
  timeMin: new Date("2026-06-29T00:00:00.000Z"),
  timeMax: new Date("2026-07-06T00:00:00.000Z"),
  maxResults: 50,
  query: null,
};

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => "" };
}

describe("createGoogleCalendarAdapter", () => {
  it("maps raw Google events to minimized summaries and drops everything else", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      // Bounded window + primary calendar are in the request URL.
      expect(url).toContain("/calendars/primary/events");
      expect(url).toContain("timeMin=2026-06-29");
      return jsonResponse({
        items: [
          {
            id: "evt-1",
            status: "confirmed",
            summary: "Coffee with Maya",
            description: "x".repeat(2000),
            location: "Blue Bottle, 123 Main St",
            updated: "2026-06-28T10:00:00.000Z",
            start: { dateTime: "2026-06-30T15:00:00.000Z" },
            end: { dateTime: "2026-06-30T15:30:00.000Z" },
            attendees: [
              { email: "maya@example.com", displayName: "Maya", responseStatus: "accepted" },
              { email: "self@example.com", self: true, organizer: true },
            ],
            // Raw fields that must NOT survive minimization:
            hangoutLink: "https://meet.google.com/abc",
            conferenceData: { secret: "dump" },
            attachments: [{ fileUrl: "https://drive/secret" }],
          },
        ],
      });
    });

    const adapter = createGoogleCalendarAdapter({
      getAccessToken: async () => "test-access-token",
      fetchImpl,
    });

    const events = await adapter.listEvents({ ...CONNECTION, ...WINDOW });

    expect(events).toHaveLength(1);
    const summary = events[0];
    expect(summary?.providerEventId).toBe("evt-1");
    expect(summary?.title).toBe("Coffee with Maya");
    expect(summary?.start).toBeInstanceOf(Date);
    expect(summary?.attendees).toHaveLength(2);
    expect(summary?.attendees[1]).toMatchObject({ self: true, organizer: true });
    // Description excerpt is capped, not the full 2000-char payload.
    expect((summary?.description ?? "").length).toBeLessThanOrEqual(281);
    // No raw provider fields leak through.
    const keys = Object.keys(summary ?? {});
    for (const forbidden of ["hangoutLink", "conferenceData", "attachments"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("treats date-only events as all-day and skips events missing id or times", async () => {
    const adapter = createGoogleCalendarAdapter({
      getAccessToken: async () => "t",
      fetchImpl: async () =>
        jsonResponse({
          items: [
            {
              id: "all-day",
              status: "confirmed",
              start: { date: "2026-07-01" },
              end: { date: "2026-07-02" },
            },
            { id: "no-times", status: "confirmed" },
            { status: "confirmed", start: { dateTime: "2026-07-01T10:00:00Z" } },
          ],
        }),
    });

    const events = await adapter.listEvents({ ...CONNECTION, ...WINDOW });

    expect(events).toHaveLength(1);
    expect(events[0]?.allDay).toBe(true);
  });

  it("raises a status-only error (no token, no payload) on a failed response", async () => {
    const adapter = createGoogleCalendarAdapter({
      getAccessToken: async () => "secret-token",
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({}),
        text: async () => "",
      }),
    });

    await expect(adapter.listEvents({ ...CONNECTION, ...WINDOW })).rejects.toMatchObject({
      name: "CalendarAuthorizationError",
      kind: "provider",
      status: 401,
    });
    await expect(adapter.listEvents({ ...CONNECTION, ...WINDOW })).rejects.not.toThrow(
      /secret-token/,
    );
  });

  it("classifies access-token retrieval failures as authorization failures", async () => {
    const adapter = createGoogleCalendarAdapter({
      getAccessToken: async () => {
        throw { body: { code: "INVALID_GRANT" } };
      },
      fetchImpl: vi.fn(),
    });

    await expect(adapter.listEvents({ ...CONNECTION, ...WINDOW })).rejects.toBeInstanceOf(
      CalendarAuthorizationError,
    );
    await expect(adapter.listEvents({ ...CONNECTION, ...WINDOW })).rejects.toMatchObject({
      kind: "token",
    });
  });

  it("leaves generic token lifecycle failures transient for stale-cache fallback", async () => {
    const error = new Error("Failed to get a valid access token");
    const adapter = createGoogleCalendarAdapter({
      getAccessToken: async () => {
        throw error;
      },
      fetchImpl: vi.fn(),
    });

    await expect(adapter.listEvents({ ...CONNECTION, ...WINDOW })).rejects.toBe(error);
  });
});
