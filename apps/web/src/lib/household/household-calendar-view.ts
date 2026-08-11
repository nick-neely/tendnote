import type { CalendarEventSummary } from "@tendnote/domain";
import {
  type HouseholdCalendarRead,
  householdCalendarEventKey,
} from "@tendnote/domain/household-calendar";
import {
  CALENDAR_PREVIEW_MAX_EVENTS,
  cachedAgoLabel,
  formatEventWhen,
  previewAttendeeSummary,
} from "@/lib/integrations/calendar-preview";

/**
 * How the household's designated calendars read on a Household surface
 * (Phase Eight, issue #387, ADR 0217).
 *
 * Everything here is provider-derived, read-through context. Nothing in this
 * shape can be accepted, dismissed, edited, or responded to, because Tendnote
 * never writes to a provider event - the only affordance a surface may hang off
 * one of these is "Plan this event", which creates a household-native record
 * beside it and changes nothing on the calendar.
 *
 * It is deliberately the same formatting the owner-scoped Account preview uses
 * ({@link formatEventWhen}, {@link previewAttendeeSummary}, {@link cachedAgoLabel}),
 * so a shared calendar event and a personal one read as the same kind of thing.
 * What differs is only its audience, and that belongs to the section around it.
 *
 * Pure: no server, provider, or authorization imports. The household read that
 * feeds it is proved before it is built, and building it again on the client
 * after a mutation must produce the same answer.
 */

/**
 * How many upcoming events one designated calendar shows.
 *
 * The same glance size as the personal preview, per calendar rather than in
 * total: a household with three calendars is answering three different
 * questions, and truncating them together would silently hide whichever one
 * happens to sort last.
 */
export const HOUSEHOLD_CALENDAR_FAMILY_EVENT_LIMIT = CALENDAR_PREVIEW_MAX_EVENTS;

export type HouseholdCalendarEventView = {
  /** Stable key, and the address a "Plan this event" press carries. */
  key: string;
  connectionId: string;
  calendarId: string;
  providerEventId: string;
  title: string;
  /** "Tue 2:30 PM" or "Mon · all day". */
  whenLabel: string;
  /** Minimized provider attendee signal. Read-only context, never Tendnote's own guest list. */
  withWhom: string | null;
  /** Google's own cancellation, reported rather than interpreted. */
  cancelled: boolean;
  /** True when this household already has an active Plan addressed to this event. */
  planned: boolean;
};

/**
 * One designated calendar's outcome, kept separate from the others on purpose.
 *
 * A family that cannot be read says so in its own row and takes nothing else
 * with it - not the other calendars, and not the Event Plans on the same screen.
 */
export type HouseholdCalendarFamilyView = {
  connectionId: string;
  label: string;
  /**
   * Whose calendar this is, named.
   *
   * Provenance, never authority: it says who put this calendar in front of the
   * household, and ADR 0217 is emphatic that doing so confers nothing over the
   * Plans that refer to it. It is here rather than omitted because a member
   * reading "Family" with no attribution cannot tell whose calendar they are
   * looking at, which is a fact about what is being exposed to them - and when
   * it stops being readable, an unattributed card leaves nobody to ask.
   *
   * `null` only when the sharer is no longer on the roster, which is a state a
   * connected calendar should not be able to reach (departure disconnects it),
   * so the surface treats it as simply having nothing to add.
   */
  sharedBy: string | null;
} & (
  | { state: "unavailable" }
  | { state: "empty"; stale: boolean; cachedLabel: string | null }
  | {
      state: "events";
      stale: boolean;
      cachedLabel: string | null;
      events: HouseholdCalendarEventView[];
    }
);

function toEventView(
  summary: CalendarEventSummary,
  input: { connectionId: string; timeZone: string; plannedKeys: ReadonlySet<string> },
): HouseholdCalendarEventView {
  const key = householdCalendarEventKey({
    connectionId: input.connectionId,
    calendarId: summary.calendarId,
    providerEventId: summary.providerEventId,
  });
  return {
    key,
    connectionId: input.connectionId,
    calendarId: summary.calendarId,
    providerEventId: summary.providerEventId,
    title: summary.title?.trim() ? summary.title : "Untitled event",
    whenLabel: formatEventWhen(summary.start, summary.allDay, input.timeZone),
    withWhom: previewAttendeeSummary(summary.attendees),
    cancelled: summary.status === "cancelled",
    planned: input.plannedKeys.has(key),
  };
}

/**
 * Turns one household calendar read into the rows a surface renders.
 *
 * `plannedEventKeys` comes from the Plans already on screen rather than from a
 * second lookup per event: the answer is the same, and asking the authorization
 * seam once per visible event would make a read-first surface pay for a fact it
 * is already holding.
 */
export function buildHouseholdCalendarFamilyViews(input: {
  read: HouseholdCalendarRead;
  now: Date;
  timeZone?: string;
  plannedEventKeys?: ReadonlySet<string>;
  /** Connection id to the sharer's display name. Absent entries render unattributed. */
  sharedByNames?: ReadonlyMap<string, string>;
}): HouseholdCalendarFamilyView[] {
  const timeZone = input.timeZone ?? "UTC";
  const plannedKeys = input.plannedEventKeys ?? new Set<string>();

  return input.read.families.map((family) => {
    const base = {
      connectionId: family.connectionId,
      label: family.label,
      sharedBy: input.sharedByNames?.get(family.connectionId) ?? null,
    };
    if (family.state === "unavailable") {
      return { ...base, state: "unavailable" as const };
    }

    const cachedLabel = family.stale ? cachedAgoLabel(family.fetchedAt, input.now) : null;
    const events = [...family.events]
      .sort((left, right) => left.start.getTime() - right.start.getTime())
      .slice(0, HOUSEHOLD_CALENDAR_FAMILY_EVENT_LIMIT)
      .map((summary) =>
        toEventView(summary, { connectionId: family.connectionId, timeZone, plannedKeys }),
      );

    if (events.length === 0) {
      return { ...base, state: "empty" as const, stale: family.stale, cachedLabel };
    }
    return { ...base, state: "events" as const, stale: family.stale, cachedLabel, events };
  });
}

/** True when at least one designated calendar could not be read this time. */
export function hasUnavailableHouseholdCalendar(
  families: readonly HouseholdCalendarFamilyView[],
): boolean {
  return families.some((family) => family.state === "unavailable");
}
