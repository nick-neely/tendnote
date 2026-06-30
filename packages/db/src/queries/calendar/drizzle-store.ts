import { calendarEventSummarySchema } from "@tendnote/domain";
import { and, eq, lt } from "drizzle-orm";
import { getDb } from "../../client";
import { calendarEventCache } from "../../schema";
import type {
  CalendarCacheEntry,
  CalendarCacheKey,
  CalendarCacheStore,
  CalendarConnectionRef,
} from "./types";

function whereKey(key: CalendarCacheKey) {
  return and(
    eq(calendarEventCache.ownerUserId, key.ownerUserId),
    eq(calendarEventCache.providerKey, key.providerKey),
    eq(calendarEventCache.capabilityKey, key.capabilityKey),
    eq(calendarEventCache.calendarId, key.calendarId),
    eq(calendarEventCache.windowKey, key.windowKey),
  );
}

/** Re-minimize jsonb rows on read so ISO date strings coerce back into Dates. */
function reviveEvents(events: unknown): CalendarCacheEntry["events"] {
  if (!Array.isArray(events)) {
    return [];
  }
  return events.map((event) => calendarEventSummarySchema.parse(event));
}

export function createDrizzleCalendarCacheStore(): CalendarCacheStore {
  return {
    async get(key) {
      const [row] = await getDb().select().from(calendarEventCache).where(whereKey(key)).limit(1);

      if (!row) {
        return null;
      }

      return {
        ownerUserId: row.ownerUserId,
        providerKey: row.providerKey,
        capabilityKey: row.capabilityKey,
        calendarId: row.calendarId,
        windowKey: row.windowKey,
        events: reviveEvents(row.events),
        fetchedAt: row.fetchedAt,
        expiresAt: row.expiresAt,
      };
    },

    async put(entry) {
      await getDb()
        .insert(calendarEventCache)
        .values({
          ownerUserId: entry.ownerUserId,
          providerKey: entry.providerKey,
          capabilityKey: entry.capabilityKey,
          calendarId: entry.calendarId,
          windowKey: entry.windowKey,
          events: entry.events,
          fetchedAt: entry.fetchedAt,
          expiresAt: entry.expiresAt,
        })
        .onConflictDoUpdate({
          target: [
            calendarEventCache.ownerUserId,
            calendarEventCache.providerKey,
            calendarEventCache.capabilityKey,
            calendarEventCache.calendarId,
            calendarEventCache.windowKey,
          ],
          set: {
            events: entry.events,
            fetchedAt: entry.fetchedAt,
            expiresAt: entry.expiresAt,
            updatedAt: new Date(),
          },
        });
    },

    async clearConnection(ref: CalendarConnectionRef) {
      const deleted = await getDb()
        .delete(calendarEventCache)
        .where(
          and(
            eq(calendarEventCache.ownerUserId, ref.ownerUserId),
            eq(calendarEventCache.providerKey, ref.providerKey),
            eq(calendarEventCache.capabilityKey, ref.capabilityKey),
          ),
        )
        .returning({ id: calendarEventCache.id });

      return deleted.length;
    },

    async evictExpired({ ref, now, staleMaxMs }) {
      // Past the stale-fallback horizon a row can never be served again, so prune it
      // (uses the fetched_at / expires_at-adjacent index). Keeps the cache bounded
      // even though the window key moves with `now`.
      const horizon = new Date(now.getTime() - staleMaxMs);
      const deleted = await getDb()
        .delete(calendarEventCache)
        .where(
          and(
            eq(calendarEventCache.ownerUserId, ref.ownerUserId),
            eq(calendarEventCache.providerKey, ref.providerKey),
            eq(calendarEventCache.capabilityKey, ref.capabilityKey),
            lt(calendarEventCache.fetchedAt, horizon),
          ),
        )
        .returning({ id: calendarEventCache.id });

      return deleted.length;
    },
  };
}
