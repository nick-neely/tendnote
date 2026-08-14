import type { getOwnerTodayContext } from "@tendnote/db/queries/today";
import { zonedWallTimeToUtc } from "@tendnote/domain";

/**
 * The owner's calendar day, as every "today" question in Eve has to mean it.
 *
 * The server runs in UTC and the owner does not. A list filtered on the server's
 * day answers "what is due before midnight in Coordinated Universal Time", which
 * for an owner in Los Angeles silently drops their whole evening and, after 4pm,
 * starts including tomorrow. `household_check_in` already reads the owner's own
 * day for exactly this reason (ADR 0220); this is the same read, shared so the
 * follow-up and Action ledgers cannot drift from it.
 *
 * The timezone comes from the owner's daily brief schedule and falls back to
 * `TENDNOTE_OWNER_TIMEZONE`, then UTC — the same resolution order the shared
 * `getOwnerTodayContext` uses, so no surface invents a second answer.
 */
export type OwnerDay = Awaited<ReturnType<typeof getOwnerTodayContext>>;

/**
 * The UTC instant at which the owner's local day starts, `daysAhead` days from
 * their today. `daysAhead: 0` is this morning's midnight, `1` is tonight's, `7`
 * is a week out — the exclusive cutoff a "today" or "this week" window needs.
 *
 * Day arithmetic happens on the calendar date rather than by adding 24-hour
 * blocks, so a window that crosses a daylight-saving transition still lands on
 * local midnight.
 */
export function ownerLocalDayStart(day: OwnerDay, daysAhead: number): Date {
  const [year, month, dayOfMonth] = day.localDate.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return zonedWallTimeToUtc({
    timeZone: day.timeZone,
    year,
    month,
    day: dayOfMonth + daysAhead,
    minute: 0,
  });
}
