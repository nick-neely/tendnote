import type { CalendarReadResult } from "@tendnote/domain";
import {
  createDrizzleBetterAuthGoogleCalendarAccessTokenProvider,
  type GoogleCalendarAccessTokenProvider,
} from "./calendar/access-token";
import { createDrizzleCalendarCacheStore } from "./calendar/drizzle-store";
import { createGoogleCalendarAdapter } from "./calendar/google-adapter";
import type { CalendarReader } from "./calendar/reader";
import { CalendarUnavailableError, createCalendarReader } from "./calendar/reader";
import type {
  CalendarCacheStore,
  CalendarProviderAdapter,
  CalendarReadRequest,
} from "./calendar/types";
import { isProviderCapabilityConnected } from "./provider-connections";

export type {
  BetterAuthGoogleAccountToken,
  GoogleCalendarAccessTokenProvider,
} from "./calendar/access-token";
export {
  createBetterAuthGoogleCalendarAccessTokenProvider,
  createDrizzleBetterAuthGoogleCalendarAccessTokenProvider,
  GoogleCalendarAccessTokenUnavailableError,
} from "./calendar/access-token";
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
  options?: {
    cacheStore?: CalendarCacheStore;
    ttlMs?: number;
    staleMaxMs?: number;
    now?: () => number;
  },
) {
  return createCalendarReader({
    adapter,
    cacheStore: options?.cacheStore ?? createDrizzleCalendarCacheStore(),
    ...options,
  });
}

export function createDefaultGoogleCalendarReader(options?: {
  getAccessToken?: GoogleCalendarAccessTokenProvider;
  cacheStore?: CalendarCacheStore;
  ttlMs?: number;
  staleMaxMs?: number;
  now?: () => number;
}) {
  const getAccessToken =
    options?.getAccessToken ?? createDrizzleBetterAuthGoogleCalendarAccessTokenProvider();

  return createDefaultCalendarReader(
    createGoogleCalendarAdapter({
      getAccessToken,
    }),
    options,
  );
}

export type OwnerCalendarReadOutcome = {
  /** Whether the owner's Calendar capability is connected. */
  connected: boolean;
  /** The bounded read, or null when disconnected or temporarily unavailable. */
  result: CalendarReadResult | null;
};

/**
 * The shared owner-scoped Calendar read that web previews, Eve, and scheduled
 * workflows all go through, so provider behavior never forks (ADR-0075). It gates
 * on the Provider Connection being connected (disconnect blocks reads, ADR-0080),
 * reads the bounded window through the injected cache-aside reader, and degrades
 * gracefully — a transient provider failure with no fresh-enough cache returns
 * `result: null` rather than throwing (ADR-0081). The reader's adapter is injected
 * by the caller, so this seam never reaches for Google credentials itself.
 */
export async function readConnectedOwnerCalendar(
  input: CalendarReadRequest,
  deps: {
    reader: CalendarReader;
    isConnected?: (ref: {
      ownerUserId: string;
      providerKey: string;
      capabilityKey: string;
    }) => Promise<boolean>;
  },
): Promise<OwnerCalendarReadOutcome> {
  const ref = {
    ownerUserId: input.ownerUserId,
    providerKey: input.providerKey,
    capabilityKey: input.capabilityKey,
  };
  const isConnected = deps.isConnected ?? isProviderCapabilityConnected;

  if (!(await isConnected(ref))) {
    return { connected: false, result: null };
  }

  try {
    const result = await deps.reader.readCalendarEvents(input);
    return { connected: true, result };
  } catch (error) {
    if (error instanceof CalendarUnavailableError) {
      return { connected: true, result: null };
    }
    throw error;
  }
}
