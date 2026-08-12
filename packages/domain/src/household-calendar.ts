import { z } from "zod";
import type { CalendarEventSummary, CalendarReadResult } from "./calendar";
import { HouseholdValidationError } from "./household-policy";
import type { ActiveHouseholdAccess } from "./privacy";

/**
 * Household Calendar Connections (Phase Eight, ADR 0217).
 *
 * A Household Calendar Connection is one Household Owner's explicit designation
 * of one provider calendar as readable by the entire active Household. It is not
 * a second Calendar integration: the credential still belongs to one member's
 * own Google grant, and this record only says which calendar that member has
 * agreed to expose and who agreed to expose it.
 *
 * Two things this module deliberately does not model, because modelling them is
 * how a read-only context feature turns into a calendar client:
 *
 * - No event ownership. A Household Calendar Event is a read-through provider
 *   result. There is no Tendnote row for one, no id of our own, no mirror, no
 *   sync cursor, and no write path. What crosses this boundary is the same
 *   minimized {@link CalendarEventSummary} the owner-scoped reader already uses.
 * - No per-event audience. The confirmation is whole-household and covers every
 *   current and future active member, so there is nothing per event to decide.
 *   A household that wants a narrower audience designates a different calendar.
 */

/** The only provider and capability a Household Calendar Connection can name today. */
export const HOUSEHOLD_CALENDAR_PROVIDER = "google";
export const HOUSEHOLD_CALENDAR_CAPABILITY = "calendar";

/**
 * How many calendars one household may have designated at once.
 *
 * A cap rather than no limit because every connection is a live read against a
 * member's provider grant on every household surface, and because the shared
 * home is a bounded chronological view - a household with twenty calendars has
 * built a calendar client, which is the thing ADR 0217 says this is not. Product
 * policy, held here rather than as a database constraint, like the seat limit.
 */
export const HOUSEHOLD_CALENDAR_CONNECTION_LIMIT = 4;

/** How the household names this calendar. Its own label, not the provider's. */
export const HOUSEHOLD_CALENDAR_LABEL_LIMIT = 60;

/**
 * A connection is connected or it is not.
 *
 * There is deliberately no `unavailable` state stored: whether a connected
 * calendar can be read right now is a live provider fact that changes minute to
 * minute, and persisting it would create a second, staler answer beside the read
 * itself. Loss of access ends the connection (`disconnected`); a failing read
 * stays a read outcome.
 */
export const householdCalendarConnectionStatusSchema = z.enum(["connected", "disconnected"]);
export type HouseholdCalendarConnectionStatus = z.infer<
  typeof householdCalendarConnectionStatusSchema
>;

/**
 * Why a connection ended. Recorded because the three reasons are meaningfully
 * different to a member looking at a household that lost a calendar: someone
 * chose to, the person holding the credential left, or the household ended.
 */
export const householdCalendarDisconnectReasonSchema = z.enum([
  "owner_disconnected",
  "connector_departed",
  "household_dissolved",
]);
export type HouseholdCalendarDisconnectReason = z.infer<
  typeof householdCalendarDisconnectReasonSchema
>;

export const householdCalendarConnectionSchema = z.object({
  id: z.string(),
  householdId: z.string(),
  /**
   * The member whose provider grant this reads through - a technical connector
   * and nothing more (ADR 0217). Holding it confers no authority over the
   * connection's Tendnote surfaces or over any Event Plan that references it.
   */
  connectorUserId: z.string(),
  /** The Household Owner who made the whole-household designation. */
  designatedByUserId: z.string().nullable(),
  providerKey: z.string(),
  capabilityKey: z.string(),
  calendarId: z.string().min(1),
  label: z.string().min(1).max(HOUSEHOLD_CALENDAR_LABEL_LIMIT),
  status: householdCalendarConnectionStatusSchema,
  connectedAt: z.coerce.date(),
  disconnectedAt: z.coerce.date().nullable().default(null),
  disconnectedReason: householdCalendarDisconnectReasonSchema.nullable().default(null),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type HouseholdCalendarConnection = z.infer<typeof householdCalendarConnectionSchema>;

/** A connection as members see it: no provider identity, no credential hints. */
export type HouseholdCalendarConnectionSummary = {
  id: string;
  label: string;
  calendarId: string;
  connectorUserId: string;
  designatedByUserId: string | null;
  connectedAt: Date;
};

export function summarizeHouseholdCalendarConnection(
  connection: HouseholdCalendarConnection,
): HouseholdCalendarConnectionSummary {
  return {
    id: connection.id,
    label: connection.label,
    calendarId: connection.calendarId,
    connectorUserId: connection.connectorUserId,
    designatedByUserId: connection.designatedByUserId,
    connectedAt: connection.connectedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Governance                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Each rule is a refusal returning `string | null` paired with an assertion that
 * throws the same sentence, so a disabled control and a rejected press say
 * exactly the same thing - the household-governance seam's convention.
 */

export type HouseholdCalendarActor = {
  /** The caller's own membership in this household, or null when they have none. */
  role: "owner" | "member" | null;
  status: "invited" | "active" | "removed" | null;
};

function isActiveOwner(actor: HouseholdCalendarActor): boolean {
  return actor.role === "owner" && actor.status === "active";
}

/**
 * Connecting changes what every current and future member of the household can
 * read, which is why it is an Owner decision rather than a member one (ADR 0217).
 */
export function householdCalendarConnectRefusal(input: {
  actor: HouseholdCalendarActor;
  /** Connections already `connected` in this household. */
  connectedCount: number;
  /** True when this exact calendar is already designated here. */
  alreadyConnected?: boolean;
  /** True when the connector's own provider Calendar access is in place. */
  connectorHasCalendarAccess: boolean;
}): string | null {
  if (!isActiveOwner(input.actor)) {
    return "Only a household owner can share a calendar with everyone here.";
  }
  if (!input.connectorHasCalendarAccess) {
    return "Connect your own Google Calendar first, then you can share one with the household.";
  }
  if (input.alreadyConnected) {
    return "That calendar is already shared with this household.";
  }
  if (input.connectedCount >= HOUSEHOLD_CALENDAR_CONNECTION_LIMIT) {
    return `A household can share up to ${HOUSEHOLD_CALENDAR_CONNECTION_LIMIT} calendars. Disconnect one to share another.`;
  }
  return null;
}

export function assertHouseholdCalendarConnectAllowed(
  input: Parameters<typeof householdCalendarConnectRefusal>[0],
): void {
  const refusal = householdCalendarConnectRefusal(input);
  if (refusal) {
    throw new HouseholdValidationError(refusal);
  }
}

/** Disconnecting also narrows what everyone can read, so it is Owner-only too. */
export function householdCalendarDisconnectRefusal(input: {
  actor: HouseholdCalendarActor;
}): string | null {
  if (!isActiveOwner(input.actor)) {
    return "Only a household owner can stop sharing a calendar.";
  }
  return null;
}

export function assertHouseholdCalendarDisconnectAllowed(input: {
  actor: HouseholdCalendarActor;
}): void {
  const refusal = householdCalendarDisconnectRefusal(input);
  if (refusal) {
    throw new HouseholdValidationError(refusal);
  }
}

/**
 * Whether a caller may read this household's designated calendars.
 *
 * Active membership and nothing else: not the connector's identity, not an Owner
 * role, and not a personal Calendar connection of their own. A member who has
 * never linked Google reads an authorized Household Calendar exactly as well as
 * the person whose grant it rides on (ADR 0217).
 */
export function canReadHouseholdCalendars(input: {
  callerUserId: string;
  householdId: string;
  callerActiveMemberships: readonly ActiveHouseholdAccess[];
}): boolean {
  if (!input.callerUserId) return false;
  return input.callerActiveMemberships.some(
    (membership) =>
      membership.householdId === input.householdId && membership.userId === input.callerUserId,
  );
}

/* -------------------------------------------------------------------------- */
/* Read-through results                                                        */
/* -------------------------------------------------------------------------- */

/**
 * One designated calendar's read outcome.
 *
 * Per connection rather than one merged list because a household with two
 * calendars where one provider call fails must still see the other - "one
 * failing Calendar family cannot hide successful Calendar families or Plans".
 * Merging first would make any failure a failure of the whole surface.
 *
 * `unavailable` is the single outcome for every way a read can fail: the
 * connector revoked their grant, the provider errored, the token expired, the
 * calendar was deleted. A member is told the calendar cannot be read, never why,
 * because the why is a fact about another member's provider account.
 */
export type HouseholdCalendarFamily = {
  connectionId: string;
  label: string;
} & (
  | {
      state: "events";
      events: CalendarEventSummary[];
      /**
       * `stale` only when fresh provider data was unavailable and a within-horizon
       * cache entry was served instead (ADR-0081). A stale family says so and,
       * per the Phase Eight contract, never drives a new Plan or reminder.
       */
      stale: boolean;
      fetchedAt: Date;
    }
  | { state: "unavailable" }
);

/** The whole household calendar read: every designated calendar, in label order. */
export type HouseholdCalendarRead = {
  families: HouseholdCalendarFamily[];
};

export function householdCalendarFamilyFromResult(input: {
  connection: HouseholdCalendarConnectionSummary;
  result: CalendarReadResult | null;
}): HouseholdCalendarFamily {
  const base = { connectionId: input.connection.id, label: input.connection.label };
  if (!input.result) {
    return { ...base, state: "unavailable" };
  }
  return {
    ...base,
    state: "events",
    events: input.result.events,
    stale: input.result.stale,
    fetchedAt: input.result.fetchedAt,
  };
}

/**
 * The reference an Event Plan stores and a surface keys on.
 *
 * All three parts, because a provider event id is only unique within its
 * calendar, and a calendar is only reachable through the connection that
 * designated it. It is an address, not content: nothing about the event's title,
 * time, attendees, or status is carried here.
 */
export type HouseholdCalendarEventRef = {
  connectionId: string;
  calendarId: string;
  providerEventId: string;
};

/**
 * One string identifying one referenced event, for keying and set membership.
 *
 * The separator is NUL rather than a printable character because two of the
 * three parts are provider-supplied: a calendar id is often an address and a
 * provider event id is an opaque token, and neither has a character set we get
 * to rely on. With a printable separator, ("a b", "c") and ("a", "b c") collapse
 * to one key; NUL cannot occur in either, so distinct references cannot collide.
 * It is written as an escape, never as a literal byte in this file.
 */
export function householdCalendarEventKey(ref: HouseholdCalendarEventRef): string {
  return [ref.connectionId, ref.calendarId, ref.providerEventId].join("\u0000");
}

/** Locates one referenced event inside a read, or `null` when it is not there. */
export function findHouseholdCalendarEvent(
  read: HouseholdCalendarRead,
  ref: HouseholdCalendarEventRef,
): CalendarEventSummary | null {
  const family = read.families.find((candidate) => candidate.connectionId === ref.connectionId);
  if (family?.state !== "events") return null;
  return (
    family.events.find(
      (event) =>
        event.calendarId === ref.calendarId && event.providerEventId === ref.providerEventId,
    ) ?? null
  );
}
