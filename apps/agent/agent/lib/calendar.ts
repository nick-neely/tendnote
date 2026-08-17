import {
  type CalendarReader,
  createBetterAuthGoogleCalendarAccessTokenProvider,
  createDefaultGoogleCalendarReader,
  type GoogleCalendarAccessTokenProvider,
} from "@tendnote/db/queries/calendar";
import { getAgentAuth } from "./auth-server";

/**
 * Compose Eve's non-request Calendar token path with Better Auth's server-side
 * access-token operation. No request headers are available or needed here:
 * Better Auth accepts the explicitly scoped owner id, decrypts/refreshes the
 * encrypted account token, and persists refreshed credentials itself.
 */
export function createAgentGoogleCalendarAccessTokenProvider(): GoogleCalendarAccessTokenProvider {
  const auth = getAgentAuth();
  return createBetterAuthGoogleCalendarAccessTokenProvider({
    getAccessToken: ({ body }) => auth.api.getAccessToken({ body }),
  });
}

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
  getAccessToken: GoogleCalendarAccessTokenProvider = createAgentGoogleCalendarAccessTokenProvider(),
): CalendarReader {
  return createDefaultGoogleCalendarReader({
    getAccessToken: (ref) => getAccessToken({ ...ref, ownerUserId }),
  });
}
