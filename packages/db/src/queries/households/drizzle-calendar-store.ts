import { calendarEventSummarySchema, householdCalendarConnectionSchema } from "@tendnote/domain";
import { and, eq, inArray, lt } from "drizzle-orm";
import { type DatabaseExecutor, getDb } from "../../client";
import { householdCalendarConnections, householdCalendarEventCache } from "../../schema";
import type { CalendarCacheEntry, CalendarCacheStore } from "../calendar/types";
import type { HouseholdCalendarStore } from "./calendar-types";

/** Re-minimize jsonb rows on read so ISO date strings coerce back into Dates. */
function reviveEvents(events: unknown): CalendarCacheEntry["events"] {
  if (!Array.isArray(events)) return [];
  return events.map((event) => calendarEventSummarySchema.parse(event));
}

/**
 * The Household read cache, bound to one connection.
 *
 * It satisfies the same `CalendarCacheStore` port the owner-scoped reader uses,
 * so the freshness, minimization, and stale-fallback behavior is the one
 * implementation in `createCalendarReader` rather than a second copy that could
 * drift. What differs is only the identity: rows live in
 * `household_calendar_event_cache`, keyed by connection, and the owner/provider/
 * capability parts of a cache key are not consulted - they are constant for a
 * connection, and honoring them would let a key constructed elsewhere reach into
 * a household's cache (ADR 0217).
 */
function createConnectionCacheStore(
  connectionId: string,
  resolveDb: () => DatabaseExecutor,
): CalendarCacheStore {
  return {
    async get(key) {
      const [row] = await resolveDb()
        .select()
        .from(householdCalendarEventCache)
        .where(
          and(
            eq(householdCalendarEventCache.connectionId, connectionId),
            eq(householdCalendarEventCache.calendarId, key.calendarId),
            eq(householdCalendarEventCache.windowKey, key.windowKey),
          ),
        )
        .limit(1);

      if (!row) return null;
      return {
        ownerUserId: key.ownerUserId,
        providerKey: key.providerKey,
        capabilityKey: key.capabilityKey,
        calendarId: row.calendarId,
        windowKey: row.windowKey,
        events: reviveEvents(row.events),
        fetchedAt: row.fetchedAt,
        expiresAt: row.expiresAt,
      };
    },

    async put(entry) {
      await resolveDb()
        .insert(householdCalendarEventCache)
        .values({
          connectionId,
          calendarId: entry.calendarId,
          windowKey: entry.windowKey,
          events: entry.events,
          fetchedAt: entry.fetchedAt,
          expiresAt: entry.expiresAt,
        })
        .onConflictDoUpdate({
          target: [
            householdCalendarEventCache.connectionId,
            householdCalendarEventCache.calendarId,
            householdCalendarEventCache.windowKey,
          ],
          set: {
            events: entry.events,
            fetchedAt: entry.fetchedAt,
            expiresAt: entry.expiresAt,
            updatedAt: new Date(),
          },
        });
    },

    async clearConnection() {
      const deleted = await resolveDb()
        .delete(householdCalendarEventCache)
        .where(eq(householdCalendarEventCache.connectionId, connectionId))
        .returning({ id: householdCalendarEventCache.id });
      return deleted.length;
    },

    async evictExpired({ now, staleMaxMs }) {
      // Past the stale-fallback horizon a row can never be served again. The
      // window key moves with `now`, so each live read writes a fresh row; this
      // is what keeps that bounded without a separate sweeper.
      const horizon = new Date(now.getTime() - staleMaxMs);
      const deleted = await resolveDb()
        .delete(householdCalendarEventCache)
        .where(
          and(
            eq(householdCalendarEventCache.connectionId, connectionId),
            lt(householdCalendarEventCache.fetchedAt, horizon),
          ),
        )
        .returning({ id: householdCalendarEventCache.id });
      return deleted.length;
    },
  };
}

export function createDrizzleHouseholdCalendarStore(
  resolveDb: () => DatabaseExecutor = getDb,
): HouseholdCalendarStore {
  return {
    async listConnections(input) {
      const rows = await resolveDb()
        .select()
        .from(householdCalendarConnections)
        .where(
          input.status
            ? and(
                eq(householdCalendarConnections.householdId, input.householdId),
                eq(householdCalendarConnections.status, input.status),
              )
            : eq(householdCalendarConnections.householdId, input.householdId),
        );
      return rows.map((row) => householdCalendarConnectionSchema.parse(row));
    },

    async getConnection(input) {
      const [row] = await resolveDb()
        .select()
        .from(householdCalendarConnections)
        .where(eq(householdCalendarConnections.id, input.connectionId))
        .limit(1);
      return row ? householdCalendarConnectionSchema.parse(row) : null;
    },

    async listConnectionsForConnector(input) {
      const rows = await resolveDb()
        .select()
        .from(householdCalendarConnections)
        .where(
          and(
            eq(householdCalendarConnections.householdId, input.householdId),
            eq(householdCalendarConnections.connectorUserId, input.connectorUserId),
            eq(householdCalendarConnections.status, "connected"),
          ),
        );
      return rows.map((row) => householdCalendarConnectionSchema.parse(row));
    },

    async designateConnection(input) {
      const [row] = await resolveDb()
        .insert(householdCalendarConnections)
        .values({
          householdId: input.householdId,
          connectorUserId: input.connectorUserId,
          designatedByUserId: input.designatedByUserId,
          providerKey: input.providerKey,
          capabilityKey: input.capabilityKey,
          calendarId: input.calendarId,
          label: input.label,
          status: "connected",
          connectedAt: input.at,
        })
        .onConflictDoUpdate({
          target: [
            householdCalendarConnections.householdId,
            householdCalendarConnections.connectorUserId,
            householdCalendarConnections.providerKey,
            householdCalendarConnections.capabilityKey,
            householdCalendarConnections.calendarId,
          ],
          set: {
            designatedByUserId: input.designatedByUserId,
            label: input.label,
            status: "connected",
            connectedAt: input.at,
            disconnectedAt: null,
            disconnectedReason: null,
            updatedAt: input.at,
          },
        })
        .returning();

      if (!row) {
        throw new Error("Failed to designate household calendar connection.");
      }
      return householdCalendarConnectionSchema.parse(row);
    },

    async disconnectConnections(input) {
      if (input.connectionIds.length === 0) return 0;

      const disconnected = await resolveDb()
        .update(householdCalendarConnections)
        .set({
          status: "disconnected",
          disconnectedAt: input.at,
          disconnectedReason: input.reason,
          updatedAt: input.at,
        })
        .where(
          and(
            inArray(householdCalendarConnections.id, [...input.connectionIds]),
            eq(householdCalendarConnections.status, "connected"),
          ),
        )
        .returning({ id: householdCalendarConnections.id });

      // The cache goes with the designation, in the same call, so no path can
      // end a connection and leave its provider data readable.
      if (disconnected.length > 0) {
        await resolveDb()
          .delete(householdCalendarEventCache)
          .where(
            inArray(
              householdCalendarEventCache.connectionId,
              disconnected.map((row) => row.id),
            ),
          );
      }

      return disconnected.length;
    },

    cacheStoreFor(input) {
      return createConnectionCacheStore(input.connectionId, resolveDb);
    },

    async clearCachesForConnector(input) {
      const connections = await resolveDb()
        .select({ id: householdCalendarConnections.id })
        .from(householdCalendarConnections)
        .where(
          and(
            eq(householdCalendarConnections.connectorUserId, input.connectorUserId),
            eq(householdCalendarConnections.providerKey, input.providerKey),
            eq(householdCalendarConnections.capabilityKey, input.capabilityKey),
          ),
        );
      if (connections.length === 0) return 0;

      const cleared = await resolveDb()
        .delete(householdCalendarEventCache)
        .where(
          inArray(
            householdCalendarEventCache.connectionId,
            connections.map((connection) => connection.id),
          ),
        )
        .returning({ id: householdCalendarEventCache.id });
      return cleared.length;
    },
  };
}
