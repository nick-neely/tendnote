import {
  assertHouseholdCalendarConnectAllowed,
  assertHouseholdCalendarDisconnectAllowed,
  type CalendarReadResult,
  canReadHouseholdCalendars,
  HOUSEHOLD_CALENDAR_CAPABILITY,
  HOUSEHOLD_CALENDAR_PROVIDER,
  type HouseholdCalendarConnection,
  type HouseholdCalendarConnectionSummary,
  type HouseholdCalendarRead,
  HouseholdRecordUnavailableError,
  HouseholdValidationError,
  householdCalendarFamilyFromResult,
  summarizeHouseholdCalendarConnection,
} from "@tendnote/domain";
import type { CalendarReader } from "../calendar/reader";
import type { HouseholdCalendarStore } from "./calendar-types";
import type { HouseholdStore } from "./types";

/** The two household reads this lifecycle needs: the caller's standing, and the roster. */
type HouseholdStandingStore = Pick<
  HouseholdStore,
  "listActiveHouseholdMembershipsForUser" | "getHouseholdMembership" | "createAuditLogEntry"
>;

export type HouseholdCalendarReadRequest = {
  callerUserId: string;
  timeMin: Date;
  timeMax: Date;
  maxResults?: number;
  query?: string | null;
};

export type HouseholdCalendarLifecycleDeps = {
  households: HouseholdStandingStore;
  calendars: HouseholdCalendarStore;
  /**
   * Builds the reader for one connection: the provider adapter bound to the
   * connector's own grant, over that connection's cache.
   *
   * Injected rather than constructed here so this seam never reaches for a
   * credential, exactly as the owner-scoped facade does not. It is also what
   * lets every test in this file run without a provider, a token, or a network.
   */
  readerFor: (connection: HouseholdCalendarConnection) => CalendarReader;
  /**
   * Whether the connector's own Calendar Provider Connection is still connected.
   *
   * A household designation is not a second authorization: it rides the
   * connector's personal grant, so revoking that grant makes the household
   * calendar unreadable immediately, without anyone having to disconnect it here
   * (ADR-0080, ADR 0217).
   */
  isConnectorConnected: (input: {
    ownerUserId: string;
    providerKey: string;
    capabilityKey: string;
  }) => Promise<boolean>;
  now?: () => Date;
};

/**
 * The Household Calendar Connection lifecycle.
 *
 * Like every other Household entry point, none of these takes a household id:
 * the household is resolved from the caller's own active membership, so there is
 * no argument shape that names someone else's workspace.
 */
export function createHouseholdCalendarLifecycle(deps: HouseholdCalendarLifecycleDeps) {
  const now = deps.now ?? (() => new Date());

  /** The caller's own active household, or a refusal that names nothing. */
  async function requireActiveHousehold(callerUserId: string) {
    const memberships = await deps.households.listActiveHouseholdMembershipsForUser({
      userId: callerUserId,
    });
    const householdId = memberships[0]?.householdId;
    if (
      !householdId ||
      !canReadHouseholdCalendars({
        callerUserId,
        householdId,
        callerActiveMemberships: memberships,
      })
    ) {
      throw new HouseholdRecordUnavailableError();
    }
    return { householdId, memberships };
  }

  async function actorFor(householdId: string, userId: string) {
    const membership = await deps.households.getHouseholdMembership({ householdId, userId });
    return { role: membership?.role ?? null, status: membership?.status ?? null };
  }

  return {
    /**
     * Designates one of the caller's own calendars as readable by the whole
     * household.
     *
     * The connector is always the caller. There is deliberately no way to
     * designate someone else's calendar: the confirmation being made here is
     * "my calendar is appropriate for everyone who lives here", and only the
     * person whose calendar it is can make it.
     */
    async connectHouseholdCalendar(input: {
      ownerUserId: string;
      calendarId: string;
      label: string;
      /** Whether the caller's own Google Calendar capability is connected. */
      connectorHasCalendarAccess: boolean;
    }): Promise<HouseholdCalendarConnectionSummary> {
      const { householdId } = await requireActiveHousehold(input.ownerUserId);
      const connected = await deps.calendars.listConnections({
        householdId,
        status: "connected",
      });
      // Standing before shape. A member who may not do this at all learns that,
      // and not that their label was also blank: telling them what to fix would
      // be coaching them through a gate they are not going to get past.
      assertHouseholdCalendarConnectAllowed({
        actor: await actorFor(householdId, input.ownerUserId),
        connectedCount: connected.length,
        alreadyConnected: connected.some(
          (connection) =>
            connection.connectorUserId === input.ownerUserId &&
            connection.calendarId === input.calendarId,
        ),
        connectorHasCalendarAccess: input.connectorHasCalendarAccess,
      });

      const label = input.label.trim();
      if (!label) {
        throw new HouseholdValidationError(
          "Give this calendar a name the household will know it by.",
        );
      }

      const at = now();
      const connection = await deps.calendars.designateConnection({
        householdId,
        connectorUserId: input.ownerUserId,
        designatedByUserId: input.ownerUserId,
        providerKey: HOUSEHOLD_CALENDAR_PROVIDER,
        capabilityKey: HOUSEHOLD_CALENDAR_CAPABILITY,
        calendarId: input.calendarId,
        label,
        at,
      });

      await deps.households.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "household.calendar.connect",
        entityType: "household_calendar_connection",
        entityId: connection.id,
        // The designation, not the calendar's contents: what is auditable here is
        // that an Owner widened the household's reading, and to which calendar.
        metadataJson: { householdId, calendarId: connection.calendarId },
      });

      return summarizeHouseholdCalendarConnection(connection);
    },

    /**
     * Stops sharing one calendar. Clearing the cache is part of the same store
     * call, so there is no ordering in which a disconnected calendar's events
     * are still readable.
     */
    async disconnectHouseholdCalendar(input: {
      ownerUserId: string;
      connectionId: string;
    }): Promise<{ disconnected: boolean }> {
      const { householdId } = await requireActiveHousehold(input.ownerUserId);
      assertHouseholdCalendarDisconnectAllowed({
        actor: await actorFor(householdId, input.ownerUserId),
      });

      const connection = await deps.calendars.getConnection({ connectionId: input.connectionId });
      // Not this household's connection is indistinguishable from no such
      // connection: the difference is the protected fact (ADR 0219).
      if (!connection || connection.householdId !== householdId) {
        throw new HouseholdRecordUnavailableError();
      }
      if (connection.status !== "connected") {
        return { disconnected: false };
      }

      await deps.calendars.disconnectConnections({
        connectionIds: [connection.id],
        reason: "owner_disconnected",
        at: now(),
      });
      await deps.households.createAuditLogEntry({
        ownerUserId: input.ownerUserId,
        action: "household.calendar.disconnect",
        entityType: "household_calendar_connection",
        entityId: connection.id,
        metadataJson: { householdId, reason: "owner_disconnected" },
      });
      return { disconnected: true };
    },

    /** This household's designated calendars, as any active member sees them. */
    async listHouseholdCalendarConnections(input: {
      callerUserId: string;
    }): Promise<HouseholdCalendarConnectionSummary[]> {
      const { householdId } = await requireActiveHousehold(input.callerUserId);
      const connections = await deps.calendars.listConnections({
        householdId,
        status: "connected",
      });
      return connections
        .map(summarizeHouseholdCalendarConnection)
        .sort((left, right) => left.label.localeCompare(right.label));
    },

    /**
     * Reads every designated calendar for one bounded window.
     *
     * Each connection is read and failed independently. A provider error, a
     * revoked connector grant, or an expired token produces one `unavailable`
     * family and leaves the others exactly as they were - a household with two
     * calendars never loses the readable one because the other broke, and the
     * Event Plans on the same surface are never affected at all.
     */
    async readHouseholdCalendars(
      input: HouseholdCalendarReadRequest,
    ): Promise<HouseholdCalendarRead> {
      const { householdId } = await requireActiveHousehold(input.callerUserId);
      const connections = await deps.calendars.listConnections({
        householdId,
        status: "connected",
      });

      const families = await Promise.all(
        connections.map(async (connection) => {
          const summary = summarizeHouseholdCalendarConnection(connection);
          const result = await readOne(connection, input);
          return householdCalendarFamilyFromResult({ connection: summary, result });
        }),
      );

      return { families: families.sort((left, right) => left.label.localeCompare(right.label)) };
    },
  };

  /** One connection's read, with every failure collapsed to "unavailable". */
  async function readOne(
    connection: HouseholdCalendarConnection,
    request: HouseholdCalendarReadRequest,
  ): Promise<CalendarReadResult | null> {
    const ref = {
      ownerUserId: connection.connectorUserId,
      providerKey: connection.providerKey,
      capabilityKey: connection.capabilityKey,
    };

    try {
      if (!(await deps.isConnectorConnected(ref))) {
        return null;
      }
      return await deps.readerFor(connection).readCalendarEvents({
        ...ref,
        calendarId: connection.calendarId,
        timeMin: request.timeMin,
        timeMax: request.timeMax,
        maxResults: request.maxResults,
        query: request.query ?? null,
      });
    } catch {
      // Deliberately every error, not only CalendarUnavailableError. A member is
      // told a calendar cannot be read; they are never told anything about
      // another member's provider account, and an unexpected failure in one
      // family must not take the whole surface down with it (ADR-0081).
      return null;
    }
  }
}

export type HouseholdCalendarLifecycle = ReturnType<typeof createHouseholdCalendarLifecycle>;
