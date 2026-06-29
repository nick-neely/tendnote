import {
  type CalendarReadResult,
  calendarEventSummarySchema,
  calendarReadWindowSchema,
  calendarWindowKey,
  DEFAULT_CALENDAR_ID,
} from "@tendnote/domain";
import type {
  CalendarCacheStore,
  CalendarConnectionRef,
  CalendarProviderAdapter,
  CalendarReadRequest,
} from "./types";

/** Normal freshness window: cached reads serve directly for this long. */
export const DEFAULT_CALENDAR_TTL_MS = 5 * 60 * 1000;
/** Max age an expired cache entry may be served as a stale fallback on live failure. */
export const DEFAULT_CALENDAR_STALE_MAX_MS = 60 * 60 * 1000;

/** Thrown when live Calendar fails and no fresh-enough cache fallback exists. */
export class CalendarUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CalendarUnavailableError";
  }
}

export type CalendarReaderOptions = {
  adapter: CalendarProviderAdapter;
  cacheStore: CalendarCacheStore;
  /** Freshness window in ms (default 5 min). */
  ttlMs?: number;
  /** Max stale-fallback age in ms (default 60 min). */
  staleMaxMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
};

/**
 * Owner-scoped cache-aside Calendar reader (ADR-0075, ADR-0081). Live Google
 * Calendar is the source of truth; the cache is keyed by owner + connection +
 * calendar id + bounded window/query shape and expires aggressively.
 *
 * - Fresh cache (within TTL) is served directly.
 * - Otherwise the provider adapter is read live, re-minimized at the boundary
 *   (unknown/raw fields are stripped by the domain schema), cached, and returned.
 * - If the live read fails, a fresh-enough expired cache entry is served marked
 *   `stale: true`; if none exists within the stale-max age, the read throws so the
 *   caller (Eve, previews, briefs) can degrade gracefully.
 */
export function createCalendarReader(options: CalendarReaderOptions) {
  const ttlMs = options.ttlMs ?? DEFAULT_CALENDAR_TTL_MS;
  const staleMaxMs = options.staleMaxMs ?? DEFAULT_CALENDAR_STALE_MAX_MS;
  const now = options.now ?? (() => Date.now());

  return {
    async readCalendarEvents(request: CalendarReadRequest): Promise<CalendarReadResult> {
      const window = calendarReadWindowSchema.parse({
        calendarId: request.calendarId ?? DEFAULT_CALENDAR_ID,
        timeMin: request.timeMin,
        timeMax: request.timeMax,
        maxResults: request.maxResults,
        query: request.query ?? null,
      });

      const ref: CalendarConnectionRef = {
        ownerUserId: request.ownerUserId,
        providerKey: request.providerKey,
        capabilityKey: request.capabilityKey,
      };
      const key = { ...ref, calendarId: window.calendarId, windowKey: calendarWindowKey(window) };
      const nowMs = now();

      const cached = await options.cacheStore.get(key);
      if (cached && nowMs < cached.expiresAt.getTime()) {
        return {
          events: cached.events,
          source: "cache",
          stale: false,
          fetchedAt: cached.fetchedAt,
          expiresAt: cached.expiresAt,
        };
      }

      try {
        const rawEvents = await options.adapter.listEvents({ ...ref, ...window });
        // Re-minimize at the boundary: the domain schema strips any unknown/raw
        // provider fields and caps excerpts, so only minimized summaries are cached.
        const events = rawEvents
          .slice(0, window.maxResults)
          .map((event) => calendarEventSummarySchema.parse(event));
        const fetchedAt = new Date(nowMs);
        const expiresAt = new Date(nowMs + ttlMs);
        await options.cacheStore.put({ ...key, events, fetchedAt, expiresAt });
        return { events, source: "live", stale: false, fetchedAt, expiresAt };
      } catch (error) {
        // Live failure (transient quota/network/etc.): serve a fresh-enough expired
        // cache entry as stale rather than blocking the surface (ADR-0081).
        if (cached && nowMs - cached.fetchedAt.getTime() <= staleMaxMs) {
          return {
            events: cached.events,
            source: "cache",
            stale: true,
            fetchedAt: cached.fetchedAt,
            expiresAt: cached.expiresAt,
          };
        }
        throw new CalendarUnavailableError("Calendar is temporarily unavailable.", {
          cause: error,
        });
      }
    },
  };
}

export type CalendarReader = ReturnType<typeof createCalendarReader>;
