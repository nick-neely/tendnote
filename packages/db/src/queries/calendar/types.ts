import type { CalendarEventSummary, CalendarReadWindow } from "@tendnote/domain";

/** Identifies one owner-scoped provider connection (provider + capability). */
export type CalendarConnectionRef = {
  ownerUserId: string;
  providerKey: string;
  capabilityKey: string;
};

/** A bounded owner-scoped calendar read request (caller-facing). */
export type CalendarReadRequest = CalendarConnectionRef & {
  /** Defaults to the owner's primary calendar (ADR-0076). */
  calendarId?: string;
  timeMin: Date;
  timeMax: Date;
  maxResults?: number;
  query?: string | null;
};

/** The fully-resolved bounded window handed to the provider adapter. */
export type CalendarProviderReadInput = CalendarConnectionRef & CalendarReadWindow;

/**
 * Replaceable provider adapter (ADR-0075). Returns minimized event summaries for a
 * bounded window and performs no writes. Normal tests inject a fake so they never
 * call Google; the live Google adapter is injected only where a token is available.
 */
export type CalendarProviderAdapter = {
  listEvents: (input: CalendarProviderReadInput) => Promise<CalendarEventSummary[]>;
};

/** Full cache key: owner + connection + calendar id + bounded window/query shape. */
export type CalendarCacheKey = CalendarConnectionRef & {
  calendarId: string;
  windowKey: string;
};

export type CalendarCacheEntry = CalendarCacheKey & {
  events: CalendarEventSummary[];
  fetchedAt: Date;
  expiresAt: Date;
};

/**
 * Short-lived minimized cache store (ADR-0075). `clearConnection` supports
 * disconnect cleanup (ADR-0080, issue #109): it removes every cached window for an
 * owner's connection and reports how many rows were cleared.
 */
export type CalendarCacheStore = {
  get: (key: CalendarCacheKey) => Promise<CalendarCacheEntry | null>;
  put: (entry: CalendarCacheEntry) => Promise<void>;
  clearConnection: (ref: CalendarConnectionRef) => Promise<number>;
  /**
   * Prune a connection's cache rows that can no longer be served — not even as a
   * stale fallback (ADR-0075 "expire aggressively", ADR-0081). An entry is
   * serviceable while `now - fetchedAt <= staleMaxMs`; this removes those older than
   * that horizon and returns how many rows were deleted. The window key derives from
   * a moving `now`, so each live read writes a fresh row; the reader calls this after
   * every live fetch to keep the cache bounded without a separate sweeper.
   */
  evictExpired: (input: {
    ref: CalendarConnectionRef;
    now: Date;
    staleMaxMs: number;
  }) => Promise<number>;
};
