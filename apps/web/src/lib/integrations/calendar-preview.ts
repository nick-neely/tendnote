import type { CalendarAttendee, CalendarEventSummary, CalendarReadResult } from "@tendnote/domain";

/**
 * Account-page Google Calendar preview view model (Phase 2C, issue #110).
 *
 * The preview is READ-ONLY provider-derived context — not approved memory and not
 * an active follow-up — so it carries no accept/dismiss/edit affordances and renders
 * in neutral (not sage/clay) treatment. Live Google Calendar is the source of truth;
 * when only an expired cache is available the preview is marked stale (ADR-0081).
 *
 * Pure (no server, network, or Better Auth imports) so the state machine and
 * formatting are unit-testable; the server glue that reads + authorizes lives in the
 * server-only data module.
 */

/** How many upcoming events the preview shows at most — a glance, not a list. */
export const CALENDAR_PREVIEW_MAX_EVENTS = 4;

export type CalendarPreviewEvent = {
  /** Stable key (provider event id) — never rendered. */
  id: string;
  title: string;
  /** Human "when" label, e.g. "Tue 2:30 PM" or "Mon · all day". */
  whenLabel: string;
  /** Minimized attendee signal, e.g. "with Maya +2", or null when solo/none. */
  withWhom: string | null;
};

export type CalendarPreviewView =
  | { state: "hidden" }
  | { state: "unavailable" }
  | { state: "empty"; stale: boolean; cachedLabel: string | null }
  | {
      state: "events";
      events: CalendarPreviewEvent[];
      stale: boolean;
      cachedLabel: string | null;
    };

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] ?? value;
}

/** A minimized "with whom" signal from attendees, excluding the owner (self). */
export function previewAttendeeSummary(attendees: readonly CalendarAttendee[]): string | null {
  const others = attendees.filter((attendee) => !attendee.self);
  if (others.length === 0) {
    return null;
  }
  const named = others.find((attendee) => attendee.displayName || attendee.email);
  const label = named?.displayName
    ? firstName(named.displayName)
    : (named?.email?.split("@")[0] ?? null);
  if (!label) {
    return `with ${others.length} ${others.length === 1 ? "guest" : "guests"}`;
  }
  const extra = others.length - 1;
  return extra > 0 ? `with ${label} +${extra}` : `with ${label}`;
}

/** Format an event's start as a short, calm "when" label in the given timezone. */
export function formatEventWhen(start: Date, allDay: boolean, timeZone = "UTC"): string {
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(start);
  if (allDay) {
    return `${day} · all day`;
  }
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(start);
  return `${day} ${time}`;
}

/** Relative "cached N ago" label for stale data (whole minutes/hours/days). */
export function cachedAgoLabel(fetchedAt: Date, now: Date): string {
  const ms = Math.max(0, now.getTime() - fetchedAt.getTime());
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) {
    return "moments ago";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

function toPreviewEvent(summary: CalendarEventSummary, timeZone: string): CalendarPreviewEvent {
  return {
    id: summary.providerEventId,
    title: summary.title?.trim() ? summary.title : "Untitled event",
    whenLabel: formatEventWhen(summary.start, summary.allDay, timeZone),
    withWhom: previewAttendeeSummary(summary.attendees),
  };
}

/**
 * Map the connection status + a calendar read (or its absence) into the preview
 * view model. `hidden` when the calendar is not connected (the connection row
 * already shows that); `unavailable` when connected but the read failed with no
 * cache; otherwise an events/empty state, marked stale when an expired cache was
 * served as a fallback.
 */
export function buildCalendarPreviewView(input: {
  connected: boolean;
  result: CalendarReadResult | null;
  now: Date;
  timeZone?: string;
}): CalendarPreviewView {
  if (!input.connected) {
    return { state: "hidden" };
  }
  if (!input.result) {
    return { state: "unavailable" };
  }

  const timeZone = input.timeZone ?? "UTC";
  const stale = input.result.stale;
  const cachedLabel = stale ? cachedAgoLabel(input.result.fetchedAt, input.now) : null;
  const events = input.result.events
    .slice(0, CALENDAR_PREVIEW_MAX_EVENTS)
    .map((summary) => toPreviewEvent(summary, timeZone));

  if (events.length === 0) {
    return { state: "empty", stale, cachedLabel };
  }
  return { state: "events", events, stale, cachedLabel };
}
