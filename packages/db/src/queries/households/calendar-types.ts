import type {
  HouseholdCalendarConnection,
  HouseholdCalendarConnectionStatus,
  HouseholdCalendarDisconnectReason,
} from "@tendnote/domain";
import type { CalendarCacheStore } from "../calendar/types";

/**
 * The stored side of Household Calendar Connections.
 *
 * `cacheStoreFor` hands back a cache bound to one connection rather than a
 * global store the caller keys into. That is the household cache identity ADR
 * 0217 asks for made structural: there is no argument shape here that could ask
 * the household cache for an owner-scoped entry, or the reverse.
 */
export type HouseholdCalendarStore = {
  listConnections: (input: {
    householdId: string;
    status?: HouseholdCalendarConnectionStatus;
  }) => Promise<HouseholdCalendarConnection[]>;
  getConnection: (input: { connectionId: string }) => Promise<HouseholdCalendarConnection | null>;
  /**
   * Designates a calendar, reusing this household's existing row for the same
   * connector and calendar. Reconnecting is a status transition rather than a
   * new row, so "is this calendar shared here" has one answer.
   */
  designateConnection: (input: {
    householdId: string;
    connectorUserId: string;
    designatedByUserId: string;
    providerKey: string;
    capabilityKey: string;
    calendarId: string;
    label: string;
    at: Date;
  }) => Promise<HouseholdCalendarConnection>;
  /**
   * Ends a designation and clears its cache in the same call.
   *
   * One method rather than a disconnect plus a clear, because every way a
   * connection can end - an Owner disconnecting, the connector leaving, the
   * household dissolving - must clear the cache, and a separate step is a step
   * some future path forgets. Returns how many connections ended.
   */
  disconnectConnections: (input: {
    connectionIds: readonly string[];
    reason: HouseholdCalendarDisconnectReason;
    at: Date;
  }) => Promise<number>;
  /** Every connected designation riding one member's provider grant. */
  listConnectionsForConnector: (input: {
    householdId: string;
    connectorUserId: string;
  }) => Promise<HouseholdCalendarConnection[]>;
  /** The short-lived minimized read cache for exactly one connection. */
  cacheStoreFor: (input: { connectionId: string }) => CalendarCacheStore;
  /**
   * Clears the cached provider data behind every designation riding one
   * member's grant, without ending the designations.
   *
   * The case is a connector revoking their own personal Calendar connection.
   * That is an access-changing event, so the cache it authorized must not
   * outlive it (ADR-0080, ADR 0219) - but it is not a departure and it is
   * recoverable by reconnecting, so ending the Owner's designation would make
   * the household re-decide something nobody changed their mind about. Reads are
   * already closed by the connector-connection gate; this is the retention half.
   */
  clearCachesForConnector: (input: {
    connectorUserId: string;
    providerKey: string;
    capabilityKey: string;
  }) => Promise<number>;
};
