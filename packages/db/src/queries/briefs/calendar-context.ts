import {
  type CalendarAttendee,
  type CalendarEventSummary,
  DEFAULT_CALENDAR_ID,
  PROVIDER_GOOGLE,
} from "@tendnote/domain";
import { type CalendarReaderForOwner, readConnectedOwnerCalendar } from "../calendar";

/**
 * Calendar-derived brief context (Phase 2C, #112). Scheduled and manual brief
 * generation read minimized Google Calendar highlights through the SHARED
 * owner-scoped seam (`readConnectedOwnerCalendar`) — no fork, no standalone sync
 * loop. Highlights are provider-derived, read-only context: minimized, never raw
 * payloads, and clearly not approved memory or active follow-ups. Disconnected or
 * unavailable calendars yield no highlights, so briefs degrade gracefully (ADR-0081).
 */

const CALENDAR_CAPABILITY = "calendar";

/** A minimized calendar highlight for a brief item — never a raw provider payload. */
export type BriefCalendarHighlight = {
  title: string;
  start: Date;
  allDay: boolean;
  /** Provider-derived reason line, e.g. "On your calendar, with Maya". */
  reason: string;
};

export type BriefCalendarContextInput = {
  ownerUserId: string;
  windowStart: Date;
  windowEnd: Date;
  limit: number;
};

export type BriefCalendarContextProvider = (
  input: BriefCalendarContextInput,
) => Promise<BriefCalendarHighlight[]>;

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] ?? value;
}

function withWhom(attendees: readonly CalendarAttendee[]): string | null {
  const others = attendees.filter((attendee) => !attendee.self);
  if (others.length === 0) {
    return null;
  }
  const named = others.find((attendee) => attendee.displayName || attendee.email);
  const label = named?.displayName
    ? firstName(named.displayName)
    : (named?.email?.split("@")[0] ?? null);
  if (!label) {
    return `${others.length} ${others.length === 1 ? "guest" : "guests"}`;
  }
  const extra = others.length - 1;
  return extra > 0 ? `${label} +${extra}` : label;
}

/** Map minimized event summaries to bounded, provider-derived brief highlights. */
export function mapCalendarHighlights(
  events: readonly CalendarEventSummary[],
  limit: number,
): BriefCalendarHighlight[] {
  return events.slice(0, Math.max(0, limit)).map((event) => {
    const who = withWhom(event.attendees);
    return {
      title: event.title?.trim() ? event.title : "Untitled event",
      start: event.start,
      allDay: event.allDay,
      reason: who ? `On your calendar, with ${who}` : "On your calendar",
    };
  });
}

/**
 * Build a brief calendar-context provider over the shared read seam. The reader is
 * built per owner by the caller (so the same seam serves web/Eve/briefs); a
 * disconnected or temporarily-unavailable calendar simply returns no highlights.
 */
export function createCalendarBriefContextProvider(deps: {
  readerFor: CalendarReaderForOwner;
  isConnected?: (ref: {
    ownerUserId: string;
    providerKey: string;
    capabilityKey: string;
  }) => Promise<boolean>;
}): BriefCalendarContextProvider {
  return async (input) => {
    const { connected, result } = await readConnectedOwnerCalendar(
      {
        ownerUserId: input.ownerUserId,
        providerKey: PROVIDER_GOOGLE,
        capabilityKey: CALENDAR_CAPABILITY,
        calendarId: DEFAULT_CALENDAR_ID,
        timeMin: input.windowStart,
        timeMax: input.windowEnd,
        maxResults: input.limit,
        query: null,
      },
      { reader: deps.readerFor(input.ownerUserId), isConnected: deps.isConnected },
    );

    if (!connected || !result) {
      return [];
    }
    return mapCalendarHighlights(result.events, input.limit);
  };
}
