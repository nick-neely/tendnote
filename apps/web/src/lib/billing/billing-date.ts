const BILLING_DATE = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * A billing date as the customer reads it: when a subscription ends, or when a
 * Lapsed account's data is deleted. Rendered on the server, which has no
 * reader's zone to ask, so it is pinned to UTC and reads the same everywhere.
 */
export function formatBillingDate(date: Date): string {
  return BILLING_DATE.format(date);
}
