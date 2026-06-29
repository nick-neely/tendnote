import { describe, expect, it } from "vitest";
import {
  CALENDAR_DESCRIPTION_EXCERPT_MAX,
  calendarEventSummarySchema,
  calendarExcerpt,
  calendarReadWindowSchema,
  calendarWindowKey,
  DEFAULT_CALENDAR_ID,
  DEFAULT_CALENDAR_MAX_RESULTS,
  MAX_CALENDAR_MAX_RESULTS,
} from "./calendar";

describe("calendarExcerpt", () => {
  it("returns null for empty/whitespace/missing input", () => {
    expect(calendarExcerpt(null, 50)).toBeNull();
    expect(calendarExcerpt(undefined, 50)).toBeNull();
    expect(calendarExcerpt("   ", 50)).toBeNull();
  });

  it("passes through short text and truncates long text with an ellipsis", () => {
    expect(calendarExcerpt("Coffee with Maya", 50)).toBe("Coffee with Maya");
    const long = "x".repeat(CALENDAR_DESCRIPTION_EXCERPT_MAX + 100);
    const excerpt = calendarExcerpt(long, CALENDAR_DESCRIPTION_EXCERPT_MAX);
    expect(excerpt).not.toBeNull();
    expect((excerpt as string).length).toBeLessThanOrEqual(CALENDAR_DESCRIPTION_EXCERPT_MAX);
    expect(excerpt).toMatch(/…$/);
  });
});

describe("calendarReadWindowSchema", () => {
  it("defaults to the primary calendar and a capped maxResults", () => {
    const window = calendarReadWindowSchema.parse({
      timeMin: "2026-06-29T00:00:00.000Z",
      timeMax: "2026-07-06T00:00:00.000Z",
    });
    expect(window.calendarId).toBe(DEFAULT_CALENDAR_ID);
    expect(window.maxResults).toBe(DEFAULT_CALENDAR_MAX_RESULTS);
  });

  it("rejects an inverted window and an over-cap maxResults", () => {
    expect(() =>
      calendarReadWindowSchema.parse({
        timeMin: "2026-07-06T00:00:00.000Z",
        timeMax: "2026-06-29T00:00:00.000Z",
      }),
    ).toThrow();
    expect(() =>
      calendarReadWindowSchema.parse({
        timeMin: "2026-06-29T00:00:00.000Z",
        timeMax: "2026-07-06T00:00:00.000Z",
        maxResults: MAX_CALENDAR_MAX_RESULTS + 1,
      }),
    ).toThrow();
  });

  it("keys distinct windows distinctly and identical windows identically", () => {
    const base = calendarReadWindowSchema.parse({
      timeMin: "2026-06-29T00:00:00.000Z",
      timeMax: "2026-07-06T00:00:00.000Z",
    });
    const same = calendarReadWindowSchema.parse({
      timeMin: "2026-06-29T00:00:00.000Z",
      timeMax: "2026-07-06T00:00:00.000Z",
    });
    const wider = calendarReadWindowSchema.parse({
      timeMin: "2026-06-29T00:00:00.000Z",
      timeMax: "2026-07-13T00:00:00.000Z",
    });
    const fewer = calendarReadWindowSchema.parse({
      timeMin: "2026-06-29T00:00:00.000Z",
      timeMax: "2026-07-06T00:00:00.000Z",
      maxResults: 10,
    });
    const queried = calendarReadWindowSchema.parse({
      timeMin: "2026-06-29T00:00:00.000Z",
      timeMax: "2026-07-06T00:00:00.000Z",
      query: "Maya",
    });
    expect(calendarWindowKey(base)).toBe(calendarWindowKey(same));
    // Window bounds, maxResults, AND query each change the cache key.
    expect(calendarWindowKey(base)).not.toBe(calendarWindowKey(wider));
    expect(calendarWindowKey(base)).not.toBe(calendarWindowKey(fewer));
    expect(calendarWindowKey(base)).not.toBe(calendarWindowKey(queried));
  });
});

describe("calendarEventSummarySchema", () => {
  it("coerces ISO date strings (cache round-trip) back into Dates with minimized defaults", () => {
    const summary = calendarEventSummarySchema.parse({
      providerEventId: "evt-1",
      calendarId: "primary",
      title: "Coffee with Maya",
      start: "2026-06-30T15:00:00.000Z",
      end: "2026-06-30T15:30:00.000Z",
    });
    expect(summary.start).toBeInstanceOf(Date);
    expect(summary.attendees).toEqual([]);
    expect(summary.status).toBe("confirmed");
    expect(summary.description).toBeNull();
  });
});
