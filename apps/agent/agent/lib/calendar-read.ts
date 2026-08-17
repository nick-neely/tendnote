import type { OwnerCalendarReadOutcome } from "@tendnote/db/queries/calendar";
import {
  type CalendarEventSummary,
  DEFAULT_CALENDAR_ID,
  MAX_CALENDAR_MAX_RESULTS,
  PROVIDER_GOOGLE,
} from "@tendnote/domain";

/** The Google Calendar provider capability the tool reads. */
const CALENDAR_CAPABILITY_KEY = "calendar";

/**
 * Eve Calendar read tool core (Phase 2C, ADR-0074). Pure orchestration so the
 * gating, bounded-window, minimization, and framing are unit-testable without
 * Google: the caller injects a `read` bound to the shared owner-scoped seam.
 *
 * This is READ-ONLY: it performs no durable writes and cannot create memories,
 * source records, follow-ups, drafts, or external sends. Output is framed as
 * provider-derived context, never as approved Tendnote memory.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const CALENDAR_TOOL_DEFAULT_LIMIT = 20;
export const CALENDAR_TOOL_MAX_LIMIT = 50;
export const CALENDAR_TOOL_MAX_DAYS_AHEAD = 30;
export const CALENDAR_TOOL_MAX_DAYS_BACK = 14;

export type CalendarToolInput = {
  daysAhead?: number;
  daysBack?: number;
  query?: string | null;
  limit?: number;
};

/** A minimized, model-facing event — provider-derived, never raw payload. */
export type CalendarToolEvent = {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  status: CalendarEventSummary["status"];
  /** First names of other attendees (self excluded), capped for brevity. */
  withWhom: string[];
  location: string | null;
};

export type CalendarToolResult =
  | { status: "not_connected"; source: "google_calendar"; readOnly: true; note: string; events: [] }
  | {
      status: "unavailable";
      source: "google_calendar";
      readOnly: true;
      note: string;
      events: [];
      requiresReauthorization?: boolean;
    }
  | {
      status: "ok";
      source: "google_calendar";
      readOnly: true;
      stale: boolean;
      note: string;
      events: CalendarToolEvent[];
    };

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] ?? value;
}

function minimizeEvent(summary: CalendarEventSummary): CalendarToolEvent {
  const withWhom = summary.attendees
    .filter((attendee) => !attendee.self)
    .map((attendee) =>
      attendee.displayName
        ? firstName(attendee.displayName)
        : (attendee.email?.split("@")[0] ?? "guest"),
    )
    .slice(0, 8);

  return {
    title: summary.title?.trim() ? summary.title : "Untitled event",
    start: summary.start.toISOString(),
    end: summary.end.toISOString(),
    allDay: summary.allDay,
    status: summary.status,
    withWhom,
    location: summary.location,
  };
}

export type CalendarReadRequestForOwner = {
  ownerUserId: string;
  providerKey: string;
  capabilityKey: string;
  calendarId: string;
  timeMin: Date;
  timeMax: Date;
  maxResults: number;
  query: string | null;
};

/**
 * Run a bounded Calendar read for an owner and shape the read-only, provider-derived
 * result. `read` is the shared owner-scoped seam (gates on connection + degrades
 * gracefully); `now` is injected for deterministic tests.
 */
export async function runCalendarRead(
  args: { ownerUserId: string; input: CalendarToolInput; now: Date },
  deps: { read: (request: CalendarReadRequestForOwner) => Promise<OwnerCalendarReadOutcome> },
): Promise<CalendarToolResult> {
  const daysAhead = clampInt(args.input.daysAhead, 7, 0, CALENDAR_TOOL_MAX_DAYS_AHEAD);
  const daysBack = clampInt(args.input.daysBack, 1, 0, CALENDAR_TOOL_MAX_DAYS_BACK);
  const maxResults = clampInt(
    args.input.limit,
    CALENDAR_TOOL_DEFAULT_LIMIT,
    1,
    Math.min(CALENDAR_TOOL_MAX_LIMIT, MAX_CALENDAR_MAX_RESULTS),
  );
  const query = args.input.query?.trim() ? args.input.query.trim() : null;

  const outcome = await deps.read({
    ownerUserId: args.ownerUserId,
    providerKey: PROVIDER_GOOGLE,
    capabilityKey: CALENDAR_CAPABILITY_KEY,
    calendarId: DEFAULT_CALENDAR_ID,
    timeMin: new Date(args.now.getTime() - daysBack * MS_PER_DAY),
    timeMax: new Date(args.now.getTime() + daysAhead * MS_PER_DAY),
    maxResults,
    query,
  });

  if (!outcome.connected) {
    return {
      status: "not_connected",
      source: "google_calendar",
      readOnly: true,
      events: [],
      note: "Google Calendar isn't connected. Ask the user to connect it from their account page; do not invent events.",
    };
  }

  if (!outcome.result) {
    if (outcome.requiresReauthorization) {
      return {
        status: "unavailable",
        source: "google_calendar",
        readOnly: true,
        events: [],
        requiresReauthorization: true,
        note: "Google Calendar authorization needs to be renewed. Ask the user to reconnect Google Calendar from their account page, then try again; do not invent events.",
      };
    }
    return {
      status: "unavailable",
      source: "google_calendar",
      readOnly: true,
      events: [],
      note: "Google Calendar is temporarily unavailable. Say so plainly and suggest trying again shortly.",
    };
  }

  const events = outcome.result.events.map(minimizeEvent);
  return {
    status: "ok",
    source: "google_calendar",
    readOnly: true,
    stale: outcome.result.stale,
    events,
    note: outcome.result.stale
      ? "Read-only context from Google Calendar (cached — may be slightly out of date). It is not saved memory; do not treat it as approved facts or create reminders without the user's go-ahead."
      : "Read-only context from Google Calendar. It is not saved memory; do not treat it as approved facts or create reminders without the user's go-ahead.",
  };
}
