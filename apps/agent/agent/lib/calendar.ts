import {
  type CalendarReader,
  createDefaultGoogleCalendarReader,
  createDrizzleBetterAuthGoogleCalendarAccessTokenProvider,
  type GoogleCalendarAccessTokenProvider,
} from "@tendnote/db/queries/calendar";

/**
 * Eve's Calendar reader composition (Phase 2C, ADR-0074). Eve reads the connected
 * calendar live through the SHARED cache-aside reader: a fresh cache (populated by
 * any web/brief read) is served without a token, and only a cache miss needs a
 * live provider call. Token custody stays with Better Auth (ADR-0071), so the
 * agent never refreshes or decrypts tokens itself — it asks an injected provider.
 *
 * When no token provider is wired into this runtime, a cache miss simply degrades
 * to "temporarily unavailable" (ADR-0081) rather than failing the turn.
 */

/**
 * Build the owner-scoped Calendar reader Eve reads through. The token provider is
 * injected for tests, defaulting to the Better Auth account-token bridge. Token
 * custody remains in Better Auth account records; Eve only receives the token at
 * provider-call time and never stores or logs it.
 */
export function createOwnerCalendarReader(
  ownerUserId: string,
  getAccessToken: GoogleCalendarAccessTokenProvider = createDrizzleBetterAuthGoogleCalendarAccessTokenProvider(),
): CalendarReader {
  return createDefaultGoogleCalendarReader({
    getAccessToken: (ref) => getAccessToken({ ...ref, ownerUserId }),
  });
}
