/**
 * Calendar dates ("2026-03-14") are day-precise facts, not instants: a warranty expires
 * on a *day*, a follow-up is due on a *day*. Resolving one with `new Date(value)` parses
 * it as UTC midnight, so reading its parts back in local time shifts the day backward
 * everywhere west of Greenwich — the classic off-by-one that turns "due Mar 14" into
 * "due Mar 13" (issue #44).
 *
 * This is the single parser for that conversion. Every surface that turns a stored
 * calendar date into a Date — Asset Memory values, Asset-derived action proposals,
 * follow-up date inputs — goes through it, so the day can never shift in one place and
 * hold in another.
 */

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A `YYYY-MM-DD` calendar date as local midnight on that day, or null when the value is
 * not a well-formed calendar date. Null-returning on purpose: callers that must reject
 * bad input can raise their own curated message, and callers that merely display a value
 * can fall back to the raw string rather than crashing a page over a malformed row.
 */
export function parseLocalCalendarDate(value: string): Date | null {
  if (!CALENDAR_DATE.test(value)) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}
