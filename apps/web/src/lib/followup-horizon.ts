/**
 * How far ahead the dashboard's Follow-ups tab looks, and how that span reads in
 * copy. The number and the words live together so an empty tab can never promise
 * a window the query does not use.
 *
 * The tab answers "what is near", not "what exists". Unbounded, the five soonest
 * reminders can all be annual birthday follow-ups seven months out - they fill the
 * tab and its count with things the owner can do nothing about today while burying
 * anything actually near. Two weeks is the span a person can hold in mind: long
 * enough that a reminder arrives with time to act on it, short enough that
 * everything listed is still recognisably soon. Nothing is hidden by the horizon -
 * later reminders stay on the person's page, reach Today on their own day, and the
 * empty tab names the next one.
 */
const DASHBOARD_FOLLOWUP_HORIZON_DAYS = 14;

/** The horizon in words, for copy that must match the query. */
export const DASHBOARD_FOLLOWUP_HORIZON_LABEL = "the next two weeks";

/** The instant the horizon closes, counted forward from `now` in local days. */
export function followupHorizonFrom(now: Date): Date {
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + DASHBOARD_FOLLOWUP_HORIZON_DAYS);
  return horizon;
}
