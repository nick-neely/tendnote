import { PROVIDER_GOOGLE } from "@tendnote/domain";
import type { BetterAuthAccountIdResolver } from "../better-auth-accounts";
import { CalendarAuthorizationError } from "./errors";
import type { CalendarConnectionRef } from "./types";

const CALENDAR_CAPABILITY = "calendar";

export class GoogleCalendarAccessTokenUnavailableError extends Error {
  constructor(message = "Google Calendar access token is unavailable.") {
    super(message);
    this.name = "GoogleCalendarAccessTokenUnavailableError";
  }
}

export type BetterAuthGoogleAccessTokenResult = {
  accessToken?: string | null;
  accessTokenExpiresAt?: Date | null;
};

export type GoogleCalendarAccessTokenProvider = (ref: CalendarConnectionRef) => Promise<string>;

/**
 * The small server-side Better Auth operation the Calendar boundary needs. The
 * caller supplies the configured auth instance, so this package never reads or
 * decrypts account token columns itself. Better Auth owns OAuth token custody,
 * decryption, refresh, and persistence (ADR-0071).
 *
 * Better Auth 1.7 selects the account by its row id rather than by provider, so
 * the caller must resolve the owner's linked Google account first. The owner id
 * still travels with the call: Better Auth rejects a row that does not belong
 * to it, which keeps the explicit owner scope this boundary depends on.
 */
export type BetterAuthGoogleAccessTokenApi = (input: {
  body: { accountId: string; userId: string };
}) => Promise<BetterAuthGoogleAccessTokenResult | null>;

/**
 * Better Auth 1.6.20 deliberately collapses decryption failures, provider
 * refresh failures, and refresh-network failures into one
 * `FAILED_TO_GET_ACCESS_TOKEN` API error. Keep the small set of explicit
 * account/credential failures reconnectable, while allowing the masked generic
 * failure to use the Calendar stale-cache fallback. The boundary cannot
 * truthfully call a masked failure a revocation because the API discards its
 * cause; if Better Auth exposes a typed cause later, extend this classifier.
 */
const REAUTHORIZATION_CODES = new Set([
  "ACCOUNT_NOT_FOUND",
  "ACCESS_TOKEN_NOT_FOUND",
  "REFRESH_TOKEN_NOT_FOUND",
  "INVALID_GRANT",
  "INVALID_TOKEN",
  "UNAUTHORIZED_CLIENT",
  "ACCESS_DENIED",
  "CONSENT_REQUIRED",
  "LOGIN_REQUIRED",
]);

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as {
    code?: unknown;
    body?: { code?: unknown } | null;
    data?: { code?: unknown } | null;
  };
  for (const value of [candidate.code, candidate.body?.code, candidate.data?.code]) {
    if (typeof value === "string") return value.toUpperCase();
  }
  return null;
}

function isKnownReauthorizationFailure(error: unknown): boolean {
  if (REAUTHORIZATION_CODES.has(errorCode(error) ?? "")) return true;
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  return (
    candidate.status === 401 ||
    candidate.status === 403 ||
    candidate.statusCode === 401 ||
    candidate.statusCode === 403
  );
}

/** Public seam for callers/tests that need to preserve reconnect semantics. */
export { isKnownReauthorizationFailure as isGoogleCalendarReauthorizationFailure };

export function createBetterAuthGoogleCalendarAccessTokenProvider(deps: {
  findAccountId: BetterAuthAccountIdResolver;
  getAccessToken: BetterAuthGoogleAccessTokenApi;
}): GoogleCalendarAccessTokenProvider {
  return async (ref) => {
    if (ref.providerKey !== PROVIDER_GOOGLE || ref.capabilityKey !== CALENDAR_CAPABILITY) {
      throw new GoogleCalendarAccessTokenUnavailableError();
    }

    // An owner with no linked Google account can only be fixed by reconnecting,
    // which is the same outcome Better Auth's own ACCOUNT_NOT_FOUND produces.
    const accountId = await deps.findAccountId({
      ownerUserId: ref.ownerUserId,
      providerId: PROVIDER_GOOGLE,
    });
    if (!accountId) {
      throw new CalendarAuthorizationError("token", {
        cause: new GoogleCalendarAccessTokenUnavailableError(),
      });
    }

    let token: BetterAuthGoogleAccessTokenResult | null;
    try {
      token = await deps.getAccessToken({
        body: {
          accountId,
          userId: ref.ownerUserId,
        },
      });
    } catch (error) {
      if (isKnownReauthorizationFailure(error)) {
        throw new CalendarAuthorizationError("token", { cause: error });
      }
      // Better Auth's generic refresh error and transport failures are not
      // proof that the owner revoked access. Let the reader serve bounded stale
      // cache instead of telling the owner to reconnect prematurely.
      throw error;
    }

    if (!token?.accessToken) {
      throw new CalendarAuthorizationError("token", {
        cause: new GoogleCalendarAccessTokenUnavailableError(),
      });
    }

    return token.accessToken;
  };
}
