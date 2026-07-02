import type { OwnerCalendarReadOutcome } from "@tendnote/db/queries/calendar";
import type { CalendarEventSummary } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import {
  CALENDAR_TOOL_MAX_DAYS_AHEAD,
  CALENDAR_TOOL_MAX_DAYS_BACK,
  CALENDAR_TOOL_MAX_LIMIT,
  type CalendarReadRequestForOwner,
  runCalendarRead,
} from "../lib/calendar-read";

/**
 * Phase 2C Eve Calendar safety evals (PRD #105, ADR-0074). Calendar context Eve
 * surfaces must read as PROVIDER-DERIVED, BOUNDED, READ-ONLY, and NOT approved
 * memory, and must degrade gracefully on disconnect/error/stale states. Deterministic
 * — uses an injected fake read, never Google or the network.
 *
 * Complements `calendar-read-tool.test.ts`, which pins the exact tool contract
 * (gating, clamp values). This file pins the four named safety properties of the
 * Eve surface together — including that an over-broad request is *bounded* before
 * it reaches the provider seam — so the safety guarantee is regression-checked as
 * one unit, not just as a mechanical clamp.
 */

const NOW = new Date("2026-06-30T12:00:00.000Z");

function summary(): CalendarEventSummary {
  return {
    providerEventId: "evt-1",
    calendarId: "primary",
    title: "Coffee with Maya",
    start: new Date("2026-06-30T15:00:00.000Z"),
    end: new Date("2026-06-30T15:30:00.000Z"),
    allDay: false,
    status: "confirmed",
    attendees: [],
    location: null,
    description: null,
    updatedAt: null,
  };
}

function read(outcome: OwnerCalendarReadOutcome) {
  return async () => outcome;
}

describe("Eve Calendar context is provider-derived and read-only", () => {
  it("labels live results as provider-derived context, not approved memory", async () => {
    const result = await runCalendarRead(
      { ownerUserId: "o1", input: {}, now: NOW },
      {
        read: read({
          connected: true,
          result: {
            events: [summary()],
            source: "live",
            stale: false,
            fetchedAt: NOW,
            expiresAt: new Date(NOW.getTime() + 300_000),
          },
        }),
      },
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.source).toBe("google_calendar");
    expect(result.readOnly).toBe(true);
    expect(result.note.toLowerCase()).toContain("not saved memory");
    // Never framed as an approved/confirmed fact.
    expect(result.note.toLowerCase()).not.toContain("approved memory");
  });

  it("bounds an over-broad request to a capped window and result count before reading", async () => {
    let seen: CalendarReadRequestForOwner | undefined;
    const result = await runCalendarRead(
      { ownerUserId: "o1", input: { daysAhead: 9999, daysBack: 9999, limit: 9999 }, now: NOW },
      {
        read: async (request) => {
          seen = request;
          return { connected: true, result: null };
        },
      },
    );

    // The model can ask for anything; the seam only ever sees a bounded request.
    expect(result.status).toBe("unavailable");
    expect(seen).toBeDefined();
    if (!seen) return;
    expect(seen.maxResults).toBeLessThanOrEqual(CALENDAR_TOOL_MAX_LIMIT);
    const maxSpanMs =
      (CALENDAR_TOOL_MAX_DAYS_AHEAD + CALENDAR_TOOL_MAX_DAYS_BACK) * 24 * 60 * 60 * 1000;
    expect(seen.timeMax.getTime() - seen.timeMin.getTime()).toBeLessThanOrEqual(maxSpanMs);
  });

  it("clearly marks stale cached context as possibly out of date", async () => {
    const result = await runCalendarRead(
      { ownerUserId: "o1", input: {}, now: NOW },
      {
        read: read({
          connected: true,
          result: {
            events: [summary()],
            source: "cache",
            stale: true,
            fetchedAt: new Date(NOW.getTime() - 3_600_000),
            expiresAt: NOW,
          },
        }),
      },
    );
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.note.toLowerCase()).toMatch(/cached|out of date/);
  });

  it("degrades gracefully on disconnect and on temporary unavailability", async () => {
    const disconnected = await runCalendarRead(
      { ownerUserId: "o1", input: {}, now: NOW },
      { read: read({ connected: false, result: null }) },
    );
    expect(disconnected.status).toBe("not_connected");
    expect(disconnected.events).toEqual([]);
    expect(disconnected.note).toMatch(/connect/i);

    const unavailable = await runCalendarRead(
      { ownerUserId: "o1", input: {}, now: NOW },
      { read: read({ connected: true, result: null }) },
    );
    expect(unavailable.status).toBe("unavailable");
    expect(unavailable.events).toEqual([]);
    // Calm degradation, not a fabricated answer.
    expect(unavailable.note).toMatch(/unavailable|try again/i);
  });
});
