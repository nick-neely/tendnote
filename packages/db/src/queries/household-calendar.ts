import type { HouseholdCalendarConnection } from "@tendnote/domain";
import { createDefaultCalendarReader } from "./calendar";
import { createDrizzleBetterAuthGoogleCalendarAccessTokenProvider } from "./calendar/access-token";
import { createGoogleCalendarAdapter } from "./calendar/google-adapter";
import type { CalendarProviderAdapter } from "./calendar/types";
import {
  createHouseholdCalendarLifecycle,
  type HouseholdCalendarReadRequest,
} from "./households/calendar-connections";
import { createDrizzleHouseholdCalendarStore } from "./households/drizzle-calendar-store";
import { createDrizzleHouseholdStore } from "./households/drizzle-store";
import { isProviderCapabilityConnected } from "./provider-connections";

export {
  createHouseholdCalendarLifecycle,
  type HouseholdCalendarLifecycle,
  type HouseholdCalendarReadRequest,
} from "./households/calendar-connections";
export type { HouseholdCalendarStore } from "./households/calendar-types";
export { createDrizzleHouseholdCalendarStore } from "./households/drizzle-calendar-store";
export { createInMemoryHouseholdCalendarStore } from "./households/in-memory-calendar-store";

const calendars = createDrizzleHouseholdCalendarStore();

/**
 * Builds the reader for one designated calendar.
 *
 * Two things make this the household path rather than the owner-scoped one, and
 * both are visible right here (ADR 0217): the cache comes from
 * `cacheStoreFor(connection)`, which is the household's own table keyed by
 * connection, and the token comes from the *connector's* Better Auth grant
 * rather than the caller's. The caller never needs a Google account of their
 * own, and the connector's credentials never widen beyond the calendar they
 * designated.
 */
function readerForConnection(
  connection: HouseholdCalendarConnection,
  adapter?: CalendarProviderAdapter,
) {
  return createDefaultCalendarReader(
    adapter ??
      createGoogleCalendarAdapter({
        getAccessToken: createDrizzleBetterAuthGoogleCalendarAccessTokenProvider(),
      }),
    { cacheStore: calendars.cacheStoreFor({ connectionId: connection.id }) },
  );
}

const defaultHouseholdCalendars = createHouseholdCalendarLifecycle({
  households: createDrizzleHouseholdStore(),
  calendars,
  readerFor: (connection) => readerForConnection(connection),
  isConnectorConnected: isProviderCapabilityConnected,
});

/**
 * The Household Calendar Connection entry points.
 *
 * None takes a household id: each resolves the household from the caller's own
 * active membership, so no argument shape here names someone else's workspace.
 * Connecting and disconnecting are Owner-only because both change what every
 * current and future member can read; reading is open to every active member,
 * connector or not.
 */
export function connectHouseholdCalendar(input: {
  ownerUserId: string;
  calendarId: string;
  label: string;
  connectorHasCalendarAccess: boolean;
}) {
  return defaultHouseholdCalendars.connectHouseholdCalendar(input);
}

export function disconnectHouseholdCalendar(input: { ownerUserId: string; connectionId: string }) {
  return defaultHouseholdCalendars.disconnectHouseholdCalendar(input);
}

export function listHouseholdCalendarConnections(input: { callerUserId: string }) {
  return defaultHouseholdCalendars.listHouseholdCalendarConnections(input);
}

/**
 * Reads every designated calendar for one bounded window, as read-through
 * provider context only. Nothing here is mirrored, synchronized, or written, and
 * a family that cannot be read never hides one that can.
 */
export function readHouseholdCalendars(input: HouseholdCalendarReadRequest) {
  return defaultHouseholdCalendars.readHouseholdCalendars(input);
}
