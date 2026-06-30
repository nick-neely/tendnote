import type {
  CalendarCacheEntry,
  CalendarCacheKey,
  CalendarCacheStore,
  CalendarConnectionRef,
} from "./types";

export type InMemoryCalendarCacheStore = CalendarCacheStore & {
  /** Test helper: every cached entry, for assertions. */
  entries: () => CalendarCacheEntry[];
};

function keyOf(key: CalendarCacheKey): string {
  return [key.ownerUserId, key.providerKey, key.capabilityKey, key.calendarId, key.windowKey].join(
    "\t",
  );
}

function matchesConnection(entry: CalendarCacheEntry, ref: CalendarConnectionRef): boolean {
  return (
    entry.ownerUserId === ref.ownerUserId &&
    entry.providerKey === ref.providerKey &&
    entry.capabilityKey === ref.capabilityKey
  );
}

/** Deterministic fake cache store for tests (no DB, no clock of its own). */
export function createInMemoryCalendarCacheStore(
  seed: CalendarCacheEntry[] = [],
): InMemoryCalendarCacheStore {
  const cache = new Map<string, CalendarCacheEntry>(seed.map((entry) => [keyOf(entry), entry]));

  return {
    async get(key) {
      return cache.get(keyOf(key)) ?? null;
    },

    async put(entry) {
      cache.set(keyOf(entry), entry);
    },

    async clearConnection(ref) {
      let cleared = 0;
      for (const [mapKey, entry] of cache) {
        if (matchesConnection(entry, ref)) {
          cache.delete(mapKey);
          cleared += 1;
        }
      }
      return cleared;
    },

    async evictExpired({ ref, now, staleMaxMs }) {
      const horizonMs = now.getTime() - staleMaxMs;
      let evicted = 0;
      for (const [mapKey, entry] of cache) {
        if (matchesConnection(entry, ref) && entry.fetchedAt.getTime() < horizonMs) {
          cache.delete(mapKey);
          evicted += 1;
        }
      }
      return evicted;
    },

    entries() {
      return [...cache.values()];
    },
  };
}
