import { randomUUID } from "node:crypto";
import type { HouseholdCalendarConnection } from "@tendnote/domain";
import { createInMemoryCalendarCacheStore } from "../calendar/in-memory-store";
import type { CalendarCacheEntry, CalendarCacheStore } from "../calendar/types";
import type { HouseholdCalendarStore } from "./calendar-types";

export type InMemoryHouseholdCalendarStore = HouseholdCalendarStore & {
  /** Test helper: every cached entry for one connection, for assertions. */
  cachedEntries: (input: { connectionId: string }) => CalendarCacheEntry[];
};

/**
 * Deterministic in-memory Household Calendar store for tests. No database, no
 * provider, no clock of its own.
 *
 * The per-connection caches are separate maps, which is the same isolation the
 * table's `connection_id` key gives - so a test that asserts a disconnect
 * cleared the cache is asserting the real property, not an artifact of a shared
 * map that happened to be keyed the same way.
 */
export function createInMemoryHouseholdCalendarStore(): InMemoryHouseholdCalendarStore {
  const connections = new Map<string, HouseholdCalendarConnection>();
  const caches = new Map<string, ReturnType<typeof createInMemoryCalendarCacheStore>>();

  function cacheFor(connectionId: string) {
    let cache = caches.get(connectionId);
    if (!cache) {
      cache = createInMemoryCalendarCacheStore();
      caches.set(connectionId, cache);
    }
    return cache;
  }

  /**
   * The bound cache the reader is handed. It answers only for its connection,
   * so the owner/provider/capability parts of a cache key are redundant here and
   * are deliberately not consulted - an entry cannot be reached from a different
   * connection by constructing a key.
   */
  function boundCacheStore(connectionId: string): CalendarCacheStore {
    const cache = cacheFor(connectionId);
    return {
      get: (key) => cache.get(key),
      put: (entry) => cache.put(entry),
      clearConnection: (ref) => cache.clearConnection(ref),
      evictExpired: (input) => cache.evictExpired(input),
    };
  }

  return {
    async listConnections(input) {
      return [...connections.values()].filter(
        (connection) =>
          connection.householdId === input.householdId &&
          (input.status ? connection.status === input.status : true),
      );
    },

    async getConnection(input) {
      return connections.get(input.connectionId) ?? null;
    },

    async listConnectionsForConnector(input) {
      return [...connections.values()].filter(
        (connection) =>
          connection.householdId === input.householdId &&
          connection.connectorUserId === input.connectorUserId &&
          connection.status === "connected",
      );
    },

    async designateConnection(input) {
      const existing = [...connections.values()].find(
        (connection) =>
          connection.householdId === input.householdId &&
          connection.connectorUserId === input.connectorUserId &&
          connection.providerKey === input.providerKey &&
          connection.capabilityKey === input.capabilityKey &&
          connection.calendarId === input.calendarId,
      );

      const connection: HouseholdCalendarConnection = existing
        ? {
            ...existing,
            designatedByUserId: input.designatedByUserId,
            label: input.label,
            status: "connected",
            connectedAt: input.at,
            disconnectedAt: null,
            disconnectedReason: null,
            updatedAt: input.at,
          }
        : {
            id: randomUUID(),
            householdId: input.householdId,
            connectorUserId: input.connectorUserId,
            designatedByUserId: input.designatedByUserId,
            providerKey: input.providerKey,
            capabilityKey: input.capabilityKey,
            calendarId: input.calendarId,
            label: input.label,
            status: "connected",
            connectedAt: input.at,
            disconnectedAt: null,
            disconnectedReason: null,
            createdAt: input.at,
            updatedAt: input.at,
          };

      connections.set(connection.id, connection);
      return connection;
    },

    async disconnectConnections(input) {
      let disconnected = 0;
      for (const connectionId of input.connectionIds) {
        const connection = connections.get(connectionId);
        if (connection?.status !== "connected") continue;
        connections.set(connectionId, {
          ...connection,
          status: "disconnected",
          disconnectedAt: input.at,
          disconnectedReason: input.reason,
          updatedAt: input.at,
        });
        // Ending a designation clears its cache in the same step, so there is no
        // ordering in which a disconnected calendar is still readable.
        caches.delete(connectionId);
        disconnected += 1;
      }
      return disconnected;
    },

    cacheStoreFor(input) {
      return boundCacheStore(input.connectionId);
    },

    async clearCachesForConnector(input) {
      let cleared = 0;
      for (const connection of connections.values()) {
        if (
          connection.connectorUserId !== input.connectorUserId ||
          connection.providerKey !== input.providerKey ||
          connection.capabilityKey !== input.capabilityKey
        ) {
          continue;
        }
        cleared += caches.get(connection.id)?.entries().length ?? 0;
        caches.delete(connection.id);
      }
      return cleared;
    },

    cachedEntries(input) {
      return caches.get(input.connectionId)?.entries() ?? [];
    },
  };
}
