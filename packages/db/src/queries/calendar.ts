import { createDrizzleCalendarCacheStore } from "./calendar/drizzle-store";
import { createCalendarReader } from "./calendar/reader";
import type { CalendarProviderAdapter } from "./calendar/types";

export { createDrizzleCalendarCacheStore } from "./calendar/drizzle-store";
export {
  createFailingCalendarAdapter,
  createFakeCalendarAdapter,
} from "./calendar/fake-adapter";
export type { GoogleCalendarAdapterOptions } from "./calendar/google-adapter";
export { createGoogleCalendarAdapter } from "./calendar/google-adapter";
export { createInMemoryCalendarCacheStore } from "./calendar/in-memory-store";
export {
  type CalendarReader,
  type CalendarReaderOptions,
  CalendarUnavailableError,
  createCalendarReader,
  DEFAULT_CALENDAR_STALE_MAX_MS,
  DEFAULT_CALENDAR_TTL_MS,
} from "./calendar/reader";
export type * from "./calendar/types";

/**
 * Build the default owner-scoped Calendar reader against the durable cache store
 * with an injected provider adapter (ADR-0075). The adapter is injected by the
 * caller (web/Eve/brief) where an owner access token is available, so this shared
 * seam never reaches for Google credentials itself.
 */
export function createDefaultCalendarReader(
  adapter: CalendarProviderAdapter,
  options?: { ttlMs?: number; staleMaxMs?: number; now?: () => number },
) {
  return createCalendarReader({
    adapter,
    cacheStore: createDrizzleCalendarCacheStore(),
    ...options,
  });
}

/** Clear an owner's cached Calendar windows for a connection (disconnect, #109). */
export async function clearOwnerCalendarCache(ref: {
  ownerUserId: string;
  providerKey: string;
  capabilityKey: string;
}): Promise<number> {
  return createDrizzleCalendarCacheStore().clearConnection(ref);
}
