import type { CalendarEventSummary, TodayCandidate } from "@tendnote/domain";
import type { TodayCandidateLoaderDeps } from "../candidate-loaders";
import type { TodayCandidateLoader } from "../types";
import { DAY_MS, formatDateInZone, formatTime, localDayBounds } from "./shared";

const RECENT_CALENDAR_DAYS = 7;

export async function loadCalendarCandidates(
  deps: TodayCandidateLoaderDeps,
  input: Parameters<TodayCandidateLoader>[0],
): Promise<TodayCandidate[]> {
  const { start, end } = localDayBounds(input.localDate, input.timeZone);
  const outcome = await deps.readCalendar({
    ownerUserId: input.ownerUserId,
    timeMin: new Date(start.getTime() - RECENT_CALENDAR_DAYS * DAY_MS),
    timeMax: end,
  });
  if (!outcome.result) return [];
  return outcome.result.events
    .filter((event) => event.status !== "cancelled")
    .flatMap((event) => {
      const occursToday =
        event.start.getTime() < end.getTime() && event.end.getTime() > start.getTime();
      if (occursToday) {
        return [calendarCandidate(event, outcome.result?.stale ?? false, true, input.timeZone)];
      }
      const hasRelationshipContext = event.attendees.some(
        (attendee) => !attendee.self && Boolean(attendee.displayName || attendee.email),
      );
      return event.end.getTime() <= start.getTime() && hasRelationshipContext
        ? [calendarCandidate(event, outcome.result?.stale ?? false, false, input.timeZone)]
        : [];
    });
}

function calendarCandidate(
  event: CalendarEventSummary,
  stale: boolean,
  occursToday: boolean,
  timeZone: string,
): TodayCandidate {
  const id = `${event.calendarId}:${event.providerEventId}`;
  const query = new URLSearchParams({
    calendarId: event.calendarId,
    calendarEvent: event.providerEventId,
    calendarStart: event.start.toISOString(),
  });
  if (event.title) query.set("calendarQuery", event.title);
  const href = `/account?${query.toString()}#calendar-event-${encodeURIComponent(id)}`;
  return {
    identity: `${occursToday ? "calendar" : "recent_calendar"}:${id}`,
    family: "calendar",
    record: { kind: "calendar_event", id, href },
    title: event.title ?? "Calendar event",
    context: occursToday
      ? (event.location ?? (event.allDay ? "All day" : formatTime(event.start, timeZone)))
      : `Recent Calendar · ${event.attendees
          .filter((attendee) => !attendee.self)
          .map((attendee) => attendee.displayName ?? attendee.email)
          .filter(Boolean)
          .slice(0, 2)
          .join(", ")}`,
    reason: occursToday
      ? {
          code: "calendar_today",
          key: `calendar:${id}:${event.start.toISOString()}`,
          explanation: `${stale ? "Last available Calendar: " : "Calendar event "}${event.allDay ? "today" : `at ${formatTime(event.start, timeZone)}`}.`,
        }
      : {
          code: "relationship_resurfacing",
          key: `recent-calendar:${id}:${event.end.toISOString()}`,
          explanation: `Recent event ended ${formatDateInZone(event.end, timeZone)}.`,
        },
    sourceRefs: [{ kind: "calendar_event", id }],
    action: { kind: "view_calendar", label: "View event", href },
    mandatory: occursToday,
    dueAt: event.start,
    createdAt: event.updatedAt ?? event.start,
    sensitivity: "normal",
  };
}
