/**
 * The owner's current local calendar date as `YYYY-MM-DD`, used to key daily and
 * weekly briefs so they align with the user's day rather than UTC server time
 * (PRD #65). The manual web action runs in the server's locale; the schedule
 * dispatcher (#72) owns precise per-user timezone mapping.
 */
export function currentLocalDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
