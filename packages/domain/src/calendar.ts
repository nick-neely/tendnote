import { z } from "zod";

/**
 * Minimized Google Calendar read model (Phase 2C, ADR-0072, ADR-0075, ADR-0076).
 *
 * Tendnote reads event DETAILS (not freebusy) but keeps only the minimized fields
 * needed for product behavior — never raw Google event payloads. Live Google
 * Calendar is the source of truth; these summaries back a short-lived cache, Eve
 * grounding, previews, and scheduled briefs. `calendarId` is carried through every
 * seam from day one even though the first slice defaults to the primary calendar,
 * so secondary calendars can be added later without a cache-key rewrite.
 */

/** The owner's primary calendar — the Phase 2C default (ADR-0076). */
export const DEFAULT_CALENDAR_ID = "primary";

/** Minimization caps: enough context for previews/follow-ups, never a payload dump. */
export const CALENDAR_TITLE_MAX = 300;
export const CALENDAR_LOCATION_EXCERPT_MAX = 200;
export const CALENDAR_DESCRIPTION_EXCERPT_MAX = 280;
export const CALENDAR_ATTENDEE_NAME_MAX = 200;
export const CALENDAR_MAX_ATTENDEES = 50;

/** Bounded-window defaults and the hard cap on events returned per read. */
export const DEFAULT_CALENDAR_MAX_RESULTS = 50;
export const MAX_CALENDAR_MAX_RESULTS = 250;

/** Truncate provider text to a minimized excerpt (null/empty stays null). */
export function calendarExcerpt(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export const calendarEventStatusSchema = z.enum(["confirmed", "tentative", "cancelled"]);
export type CalendarEventStatus = z.infer<typeof calendarEventStatusSchema>;

export const calendarAttendeeResponseSchema = z.enum([
  "needsAction",
  "declined",
  "tentative",
  "accepted",
]);

/**
 * A minimized attendee/contact signal: an email and/or display name plus response
 * and role flags. Enough to match existing Tendnote people later (ADR-0078) and
 * explain a follow-up, without storing the raw provider attendee object.
 */
export const calendarAttendeeSchema = z.object({
  email: z.string().max(320).nullable().default(null),
  displayName: z.string().max(CALENDAR_ATTENDEE_NAME_MAX).nullable().default(null),
  responseStatus: calendarAttendeeResponseSchema.nullable().default(null),
  self: z.boolean().default(false),
  organizer: z.boolean().default(false),
});
export type CalendarAttendee = z.infer<typeof calendarAttendeeSchema>;

/**
 * A single minimized calendar event summary. Date fields use `coerce` so summaries
 * round-trip through JSON cache storage (ISO strings) back into `Date`. This is the
 * ONLY shape that crosses the provider boundary — raw Google payloads never do.
 */
export const calendarEventSummarySchema = z.object({
  providerEventId: z.string().min(1),
  calendarId: z.string().min(1),
  title: z.string().max(CALENDAR_TITLE_MAX).nullable().default(null),
  start: z.coerce.date(),
  end: z.coerce.date(),
  allDay: z.boolean().default(false),
  status: calendarEventStatusSchema.default("confirmed"),
  attendees: z.array(calendarAttendeeSchema).max(CALENDAR_MAX_ATTENDEES).default([]),
  location: z.string().max(CALENDAR_LOCATION_EXCERPT_MAX).nullable().default(null),
  description: z.string().max(CALENDAR_DESCRIPTION_EXCERPT_MAX).nullable().default(null),
  updatedAt: z.coerce.date().nullable().default(null),
});
export type CalendarEventSummary = z.infer<typeof calendarEventSummarySchema>;

/**
 * A bounded read window/query shape. `timeMin`/`timeMax` bound the window;
 * `maxResults` is capped; `calendarId` defaults to the primary calendar. The
 * shape (not the events) is what the cache is keyed by.
 */
export const calendarReadWindowSchema = z
  .object({
    calendarId: z.string().min(1).default(DEFAULT_CALENDAR_ID),
    timeMin: z.coerce.date(),
    timeMax: z.coerce.date(),
    maxResults: z.coerce
      .number()
      .int()
      .positive()
      .max(MAX_CALENDAR_MAX_RESULTS)
      .default(DEFAULT_CALENDAR_MAX_RESULTS),
    query: z.string().max(200).nullable().default(null),
  })
  .refine((w) => w.timeMin.getTime() < w.timeMax.getTime(), {
    message: "Calendar read window timeMin must be before timeMax.",
  });
export type CalendarReadWindow = z.infer<typeof calendarReadWindowSchema>;
export type CalendarReadWindowInput = z.input<typeof calendarReadWindowSchema>;

/** Where a read's events came from, and whether they are beyond normal freshness. */
export type CalendarReadSource = "live" | "cache";

/**
 * Result of an owner-scoped calendar read. `stale` is true only when fresh live
 * data was unavailable and an expired cache entry was served as a fallback
 * (ADR-0081), so callers can mark out-of-date context for the user.
 */
export type CalendarReadResult = {
  events: CalendarEventSummary[];
  source: CalendarReadSource;
  stale: boolean;
  fetchedAt: Date;
  expiresAt: Date;
};

/** Deterministic key for the bounded window/query shape (cache keying, ADR-0075). */
export function calendarWindowKey(window: CalendarReadWindow): string {
  return [
    window.timeMin.toISOString(),
    window.timeMax.toISOString(),
    String(window.maxResults),
    window.query ?? "",
  ].join("|");
}
