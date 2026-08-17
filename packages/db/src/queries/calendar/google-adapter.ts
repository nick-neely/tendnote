import {
  CALENDAR_ATTENDEE_NAME_MAX,
  CALENDAR_DESCRIPTION_EXCERPT_MAX,
  CALENDAR_LOCATION_EXCERPT_MAX,
  CALENDAR_MAX_ATTENDEES,
  CALENDAR_TITLE_MAX,
  type CalendarAttendee,
  type CalendarEventStatus,
  type CalendarEventSummary,
  calendarEventSummarySchema,
  calendarExcerpt,
} from "@tendnote/domain";
import { isGoogleCalendarReauthorizationFailure } from "./access-token";
import { CalendarAuthorizationError, isCalendarAuthorizationError } from "./errors";
import type {
  CalendarConnectionRef,
  CalendarProviderAdapter,
  CalendarProviderReadInput,
} from "./types";

const GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export type GoogleCalendarAdapterOptions = {
  /** Owner-scoped access-token retrieval (Better Auth on web/agent). */
  getAccessToken: (ref: CalendarConnectionRef) => Promise<string>;
  /** Injectable fetch so tests never hit the network. */
  fetchImpl?: FetchLike;
  /** Override the API base (tests). */
  baseUrl?: string;
};

/** Raw Google event item — only the fields we minimize from. */
type RawGoogleEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{
    email?: string;
    displayName?: string;
    responseStatus?: string;
    self?: boolean;
    organizer?: boolean;
  }>;
};

function mapStatus(status: string | undefined): CalendarEventStatus {
  return status === "tentative" || status === "cancelled" ? status : "confirmed";
}

function mapInstant(slot: { dateTime?: string; date?: string } | undefined): {
  date: Date | null;
  allDay: boolean;
} {
  if (slot?.dateTime) {
    return { date: new Date(slot.dateTime), allDay: false };
  }
  if (slot?.date) {
    // All-day events carry a date-only value; anchor at UTC midnight.
    return { date: new Date(`${slot.date}T00:00:00.000Z`), allDay: true };
  }
  return { date: null, allDay: false };
}

function mapResponse(status: string | undefined): CalendarAttendee["responseStatus"] {
  return status === "accepted" ||
    status === "declined" ||
    status === "tentative" ||
    status === "needsAction"
    ? status
    : null;
}

function minimizeEvent(item: RawGoogleEvent, calendarId: string): CalendarEventSummary | null {
  if (!item.id) {
    return null;
  }
  const start = mapInstant(item.start);
  const end = mapInstant(item.end);
  if (!start.date || !end.date) {
    return null;
  }

  const attendees: CalendarAttendee[] = (item.attendees ?? [])
    .slice(0, CALENDAR_MAX_ATTENDEES)
    .map((attendee) => ({
      email: attendee.email ?? null,
      displayName: calendarExcerpt(attendee.displayName, CALENDAR_ATTENDEE_NAME_MAX),
      responseStatus: mapResponse(attendee.responseStatus),
      self: attendee.self ?? false,
      organizer: attendee.organizer ?? false,
    }));

  // Parse through the domain schema so only minimized fields can ever escape.
  return calendarEventSummarySchema.parse({
    providerEventId: item.id,
    calendarId,
    title: calendarExcerpt(item.summary, CALENDAR_TITLE_MAX),
    start: start.date,
    end: end.date,
    allDay: start.allDay,
    status: mapStatus(item.status),
    attendees,
    location: calendarExcerpt(item.location, CALENDAR_LOCATION_EXCERPT_MAX),
    description: calendarExcerpt(item.description, CALENDAR_DESCRIPTION_EXCERPT_MAX),
    updatedAt: item.updated ? new Date(item.updated) : null,
  });
}

/**
 * Live Google Calendar provider adapter (ADR-0072). Lists event details for a
 * bounded window from the given calendar and returns ONLY minimized summaries —
 * raw Google payloads never leave this adapter. The access token is injected per
 * owner so this seam stays reusable by web, Eve, and scheduled workflows, and so
 * normal tests can supply a fake fetch and never touch the network.
 */
export function createGoogleCalendarAdapter(
  options: GoogleCalendarAdapterOptions,
): CalendarProviderAdapter {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const baseUrl = options.baseUrl ?? GOOGLE_CALENDAR_API_BASE;

  return {
    async listEvents(input: CalendarProviderReadInput) {
      let token: string;
      try {
        token = await options.getAccessToken({
          ownerUserId: input.ownerUserId,
          providerKey: input.providerKey,
          capabilityKey: input.capabilityKey,
        });
      } catch (error) {
        if (isCalendarAuthorizationError(error)) throw error;
        if (isGoogleCalendarReauthorizationFailure(error)) {
          throw new CalendarAuthorizationError("token", { cause: error });
        }
        // Transport and generic Better Auth refresh failures remain transient so
        // the shared reader can serve bounded stale cache.
        throw error;
      }

      const params = new URLSearchParams({
        singleEvents: "true",
        orderBy: "startTime",
        timeMin: input.timeMin.toISOString(),
        timeMax: input.timeMax.toISOString(),
        maxResults: String(input.maxResults),
      });
      if (input.query) {
        params.set("q", input.query);
      }

      const url = `${baseUrl}/calendars/${encodeURIComponent(input.calendarId)}/events?${params.toString()}`;
      const response = await fetchImpl(url, {
        headers: { authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        // No token or raw payload in the error (ADR-0081): status only.
        if (response.status === 401 || response.status === 403) {
          throw new CalendarAuthorizationError("provider", { status: response.status });
        }
        throw new Error(`Google Calendar list failed with status ${response.status}.`);
      }

      const body = (await response.json()) as { items?: RawGoogleEvent[] };
      const items = Array.isArray(body.items) ? body.items : [];
      return items
        .map((item) => minimizeEvent(item, input.calendarId))
        .filter((event): event is CalendarEventSummary => event !== null);
    },
  };
}
