import type { OwnerCalendarReadOutcome } from "@tendnote/db/queries/calendar";
import type { CalendarEventSummary, CalendarReadResult } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import {
  CALENDAR_TOOL_MAX_LIMIT,
  type CalendarReadRequestForOwner,
  runCalendarRead,
} from "../lib/calendar-read";
import calendarTool from "../tools/list_calendar_events";

const NOW = new Date("2026-06-30T12:00:00.000Z");

function summary(overrides: Partial<CalendarEventSummary> = {}): CalendarEventSummary {
  return {
    providerEventId: overrides.providerEventId ?? "evt-1",
    calendarId: "primary",
    title: overrides.title ?? "Coffee with Maya",
    start: overrides.start ?? new Date("2026-06-30T15:00:00.000Z"),
    end: overrides.end ?? new Date("2026-06-30T15:30:00.000Z"),
    allDay: overrides.allDay ?? false,
    status: "confirmed",
    attendees: overrides.attendees ?? [],
    location: overrides.location ?? null,
    description: overrides.description ?? null,
    updatedAt: null,
  };
}

function readResult(overrides: Partial<CalendarReadResult>): CalendarReadResult {
  return {
    events: overrides.events ?? [],
    source: overrides.source ?? "live",
    stale: overrides.stale ?? false,
    fetchedAt: overrides.fetchedAt ?? NOW,
    expiresAt: overrides.expiresAt ?? new Date(NOW.getTime() + 300_000),
  };
}

function fakeRead(outcome: OwnerCalendarReadOutcome) {
  return vi.fn<(request: CalendarReadRequestForOwner) => Promise<OwnerCalendarReadOutcome>>(
    async () => outcome,
  );
}

describe("runCalendarRead", () => {
  it("tells the model the calendar is not connected, with no events", async () => {
    const read = fakeRead({ connected: false, result: null });
    const result = await runCalendarRead({ ownerUserId: "owner-1", input: {}, now: NOW }, { read });

    expect(result.status).toBe("not_connected");
    expect(result.events).toEqual([]);
    expect(result.note).toMatch(/connect/i);
  });

  it("degrades gracefully when connected but the calendar is unavailable", async () => {
    const read = fakeRead({ connected: true, result: null });
    const result = await runCalendarRead({ ownerUserId: "owner-1", input: {}, now: NOW }, { read });

    expect(result.status).toBe("unavailable");
    expect(result.events).toEqual([]);
    expect(result.note).toMatch(/unavailable/i);
  });

  it("returns minimized read-only events framed as provider-derived context", async () => {
    const read = fakeRead({
      connected: true,
      result: readResult({
        events: [
          summary({
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
            location: "Blue Bottle",
          }),
        ],
      }),
    });

    const result = await runCalendarRead({ ownerUserId: "owner-1", input: {}, now: NOW }, { read });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.readOnly).toBe(true);
    expect(result.source).toBe("google_calendar");
    expect(result.note).toMatch(/not saved memory/i);
    expect(result.events[0]).toMatchObject({
      title: "Coffee with Maya",
      withWhom: ["Maya"], // self excluded, first name only
      location: "Blue Bottle",
    });
    // No raw payload fields leak into the model-facing event.
    expect(Object.keys(result.events[0] ?? {})).not.toContain("description");
  });

  it("marks cached results stale in the framing", async () => {
    const read = fakeRead({
      connected: true,
      result: readResult({ events: [summary()], source: "cache", stale: true }),
    });
    const result = await runCalendarRead({ ownerUserId: "owner-1", input: {}, now: NOW }, { read });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.stale).toBe(true);
    expect(result.note).toMatch(/cached/i);
  });

  it("scopes the read to the owner and bounds the window + result count", async () => {
    const read = fakeRead({ connected: true, result: readResult({ events: [] }) });

    await runCalendarRead(
      { ownerUserId: "owner-9", input: { daysAhead: 999, daysBack: 999, limit: 999 }, now: NOW },
      { read },
    );

    const request = read.mock.calls[0]?.[0];
    expect(request?.ownerUserId).toBe("owner-9");
    expect(request?.providerKey).toBe("google");
    expect(request?.capabilityKey).toBe("calendar");
    expect(request?.calendarId).toBe("primary");
    // Over-large inputs are clamped to the bounded caps.
    expect(request?.maxResults).toBe(CALENDAR_TOOL_MAX_LIMIT);
    expect(request?.timeMax.getTime()).toBeLessThanOrEqual(
      NOW.getTime() + 30 * 24 * 60 * 60 * 1000,
    );
    expect(request?.timeMin.getTime()).toBeGreaterThanOrEqual(
      NOW.getTime() - 14 * 24 * 60 * 60 * 1000,
    );
  });
});

describe("list_calendar_events tool framing", () => {
  it("frames the model output as read-only provider-derived context", () => {
    const modelOutput = (
      calendarTool.toModelOutput as (o: unknown) => { type: string; value: unknown }
    )({
      status: "ok",
      source: "google_calendar",
      readOnly: true,
      stale: false,
      note: "Read-only context from Google Calendar. It is not saved memory.",
      events: [],
    });

    expect(modelOutput.type).toBe("json");
    expect(modelOutput.value).toMatchObject({ source: "google_calendar", readOnly: true });
  });
});
