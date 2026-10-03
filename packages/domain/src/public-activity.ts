import { RETENTION } from "./retention";

/**
 * The closed set of public activity events: the hosted telemetry decision's
 * public events. Each is counted as an anonymous daily total, never a row per
 * visit, with no visitor identifier and no join to accounts. Adding one
 * changes a disclosed boundary, so the set is a literal.
 */
export const PUBLIC_ACTIVITY_EVENTS = [
  "page_viewed",
  "demo_started",
  "demo_completed",
  "signup_clicked",
] as const;

export type PublicActivityEvent = (typeof PUBLIC_ACTIVITY_EVENTS)[number];

/**
 * The approved public pages, by fixed name. A counter names one of these,
 * never a raw URL, query string, or button text.
 */
export const PUBLIC_PAGES = [
  "home",
  "product",
  "demo",
  "pricing",
  "about",
  "privacy_and_ai",
  "support",
  "fair_use",
  "terms",
  "privacy",
] as const;

export type PublicPage = (typeof PUBLIC_PAGES)[number];

/** One counted moment: what happened, on which page. */
export type PublicActivity = { event: PublicActivityEvent; page: PublicPage };

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/**
 * Read a public activity report from an untrusted request body. Anything but
 * exactly a fixed event and a fixed page is rejected, so no free text can
 * reach a counter.
 */
export function parsePublicActivity(body: string): PublicActivity | null {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { event, page } = value as Record<string, unknown>;
  if (!isOneOf(PUBLIC_ACTIVITY_EVENTS, event) || !isOneOf(PUBLIC_PAGES, page)) return null;
  return { event, page };
}

/** The UTC calendar day a counter for this moment belongs to, as `YYYY-MM-DD`. */
export function publicActivityDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Daily totals for days before this one are past their retention and are
 * deleted. The same day of the month, that many months back, clamped to the
 * end of a shorter month rather than rolling into the next.
 */
export function publicActivityCutoffDay(now: Date): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() - RETENTION.anonymousDailyTotals.months;
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return publicActivityDay(
    new Date(Date.UTC(year, month, Math.min(now.getUTCDate(), lastDayOfMonth))),
  );
}

/** What the saved report reads for a window: totals per event, and page views per page. */
export type PublicActivityTotals = {
  events: Record<PublicActivityEvent, number>;
  pageViews: Record<PublicPage, number>;
};

function zeroed<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

/** Totals from rows grouped by event and page, with anything not seen as zero. */
export function publicActivityTotals(
  rows: readonly (PublicActivity & { count: number })[],
): PublicActivityTotals {
  const totals = { events: zeroed(PUBLIC_ACTIVITY_EVENTS), pageViews: zeroed(PUBLIC_PAGES) };
  for (const row of rows) {
    totals.events[row.event] += row.count;
    if (row.event === "page_viewed") totals.pageViews[row.page] += row.count;
  }
  return totals;
}

const EVENT_LABELS: Record<PublicActivityEvent, string> = {
  page_viewed: "Pages viewed",
  demo_started: "Demo started",
  demo_completed: "Demo completed",
  signup_clicked: "Signup clicked",
};

const PAGE_LABELS: Record<PublicPage, string> = {
  home: "Home",
  product: "Product",
  demo: "Demo",
  pricing: "Pricing",
  about: "About",
  privacy_and_ai: "Privacy & AI",
  support: "Support",
  fair_use: "Fair Use",
  terms: "Terms",
  privacy: "Privacy Policy",
};

function per(part: number, whole: number): string {
  return whole === 0 ? "-" : `${Math.round((part / whole) * 100)}%`;
}

/** The public activity lines of the saved operator report, under its own heading. */
export function renderPublicActivityLines(totals: PublicActivityTotals): string[] {
  const { events, pageViews } = totals;
  const width = Math.max(...Object.values(PAGE_LABELS).map((label) => label.length + 2), 14);
  const line = (label: string, value: number) =>
    `  ${label.padEnd(width)}  ${String(value).padStart(6)}`;

  return [
    line(EVENT_LABELS.page_viewed, events.page_viewed),
    ...PUBLIC_PAGES.map((page) => line(`  ${PAGE_LABELS[page]}`, pageViews[page])),
    line(EVENT_LABELS.demo_started, events.demo_started),
    line(EVENT_LABELS.demo_completed, events.demo_completed),
    line(EVENT_LABELS.signup_clicked, events.signup_clicked),
    "",
    `  Demo completed per demo started: ${per(events.demo_completed, events.demo_started)}`,
    `  Signup clicked per Pricing view: ${per(events.signup_clicked, pageViews.pricing)}`,
    "",
    "Coverage",
    "  Counted only for requests known to come from the US, and not at all when a",
    "  browser blocks the request, so every count is a floor. Totals are per UTC",
    `  day and kept ${RETENTION.anonymousDailyTotals.months} months.`,
  ];
}
