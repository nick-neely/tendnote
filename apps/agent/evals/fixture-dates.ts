/** Explicit future dates keep lifecycle fixtures independent of the day they run. */
export function futureFixtureDate(daysAhead: number, now = new Date()): string {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}
