import "server-only";

import { findBetterAuthAccountId } from "@tendnote/db/queries/better-auth-accounts";
import {
  type CalendarCacheStore,
  type CalendarReader,
  createBetterAuthGoogleCalendarAccessTokenProvider,
  createDefaultGoogleCalendarReader,
} from "@tendnote/db/queries/calendar";
import { getAuth } from "@/lib/auth/server";

/**
 * Web's owner-scoped Google Calendar token provider. Better Auth is the only
 * OAuth custody/lifecycle owner: this callback passes the explicit owner id to
 * its server-side API, which decrypts and refreshes the encrypted account row
 * as needed. It deliberately does not pass request headers because this path
 * also serves non-request readers such as briefs and Today.
 */
export function createWebGoogleCalendarAccessTokenProvider() {
  const auth = getAuth();
  return createBetterAuthGoogleCalendarAccessTokenProvider({
    findAccountId: findBetterAuthAccountId,
    getAccessToken: ({ body }) => auth.api.getAccessToken({ body }),
  });
}

/** Build a cache-aside reader bound to exactly one admitted owner. */
export function createOwnerCalendarReader(
  ownerUserId: string,
  options: {
    cacheStore?: CalendarCacheStore;
    ttlMs?: number;
    staleMaxMs?: number;
    now?: () => number;
  } = {},
): CalendarReader {
  const tokenProvider = createWebGoogleCalendarAccessTokenProvider();
  return createDefaultGoogleCalendarReader({
    ...options,
    getAccessToken: (ref) => tokenProvider({ ...ref, ownerUserId }),
  });
}
