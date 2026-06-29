import {
  type CalendarReader,
  createDefaultCalendarReader,
  createGoogleCalendarAdapter,
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

export type GoogleAccessTokenProvider = (ownerUserId: string) => Promise<string>;

/**
 * Default token provider. The live-token bridge to Better Auth is supplied by the
 * deployment; absent it, this throws so the reader degrades to cache-only +
 * graceful-unavailable rather than pretending to have a token. Passed explicitly
 * (no module-level mutable state) so wiring is per-call and test-isolated.
 */
const tokenBridgeNotConfigured: GoogleAccessTokenProvider = async () => {
  throw new Error("Google Calendar live-token bridge is not configured in this runtime.");
};

/**
 * Build the owner-scoped Calendar reader Eve reads through. The token provider is
 * injected (defaulting to the unconfigured bridge); the deployment passes a real
 * provider once the Better Auth token bridge exists.
 */
export function createOwnerCalendarReader(
  ownerUserId: string,
  getAccessToken: GoogleAccessTokenProvider = tokenBridgeNotConfigured,
): CalendarReader {
  const adapter = createGoogleCalendarAdapter({
    getAccessToken: () => getAccessToken(ownerUserId),
  });
  return createDefaultCalendarReader(adapter);
}
