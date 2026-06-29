import {
  GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE,
  hasCalendarEventsReadScope,
  PROVIDER_GOOGLE,
} from "@tendnote/domain";

/**
 * Reconcile Better Auth Google account-link state into the owner's Google Calendar
 * Provider Connection (Phase 2C, ADR-0071). Better Auth owns OAuth token custody
 * and refresh; this only mirrors NON-SECRET status, display identity, and
 * authorized scopes so web, Eve, and scheduled workflows share one read model.
 *
 * Pure (no Better Auth, next, or network imports) so the derivation is unit-
 * testable; the server glue that lists accounts and persists lives in the
 * server-only `provider-connections` boundary.
 */

export const GOOGLE_CALENDAR_CAPABILITY = "calendar" as const;

/** Shape Better Auth's `listUserAccounts` returns, narrowed to what we read. */
export type LinkedAccountLike = {
  providerId?: string | null;
  provider?: string | null;
  scopes?: readonly string[] | null;
  scope?: string | null;
  /** The linked Google account's email, when the provider/Better Auth surfaces it. */
  email?: string | null;
};

/** Parse a granted-scope value (string[] or space/comma-separated string). */
export function parseGrantedScopes(account: LinkedAccountLike): string[] {
  if (Array.isArray(account.scopes)) {
    return account.scopes.filter(
      (scope): scope is string => typeof scope === "string" && scope.length > 0,
    );
  }
  if (typeof account.scope === "string") {
    return account.scope.split(/[\s,]+/).filter((scope) => scope.length > 0);
  }
  return [];
}

function isGoogleAccount(account: LinkedAccountLike): boolean {
  return (account.providerId ?? account.provider) === PROVIDER_GOOGLE;
}

/** Granted scopes across the owner's linked Google account(s), sorted for stable storage. */
export function googleGrantedScopes(accounts: readonly LinkedAccountLike[]): string[] {
  const scopes = new Set<string>();
  for (const account of accounts) {
    if (!isGoogleAccount(account)) {
      continue;
    }
    for (const scope of parseGrantedScopes(account)) {
      scopes.add(scope);
    }
  }
  // Sorted so the mirrored value is order-stable across provider responses, which
  // keeps the connection idempotent rather than rewriting on every reconcile.
  return [...scopes].sort();
}

/** The connected Google account's email, when Better Auth surfaces it (else null). */
export function googleAccountIdentity(accounts: readonly LinkedAccountLike[]): string | null {
  for (const account of accounts) {
    if (isGoogleAccount(account) && typeof account.email === "string" && account.email.length > 0) {
      return account.email;
    }
  }
  return null;
}

/**
 * Decide whether the owner's linked Google account grants Calendar event-read
 * access. Returns the authorized scopes and the connected Google identity to
 * mirror, or `null` when no Google account grants Calendar access (nothing to
 * connect). The identity is the Google account email — NOT the Tendnote session
 * email — so the connection honestly reflects which Google account it reads.
 */
export function deriveCalendarConnection(
  accounts: readonly LinkedAccountLike[],
): { authorizedScopes: string[]; displayIdentity: string | null } | null {
  const scopes = googleGrantedScopes(accounts);
  if (!hasCalendarEventsReadScope(scopes)) {
    return null;
  }
  return { authorizedScopes: scopes, displayIdentity: googleAccountIdentity(accounts) };
}

export type ConnectCalendarFn = (input: {
  ownerUserId: string;
  providerKey: string;
  capabilityKey: string;
  displayIdentity?: string | null;
  authorizedScopes?: string[] | null;
}) => Promise<unknown>;

/**
 * Mirror the owner's Google account-link state into the Calendar Provider
 * Connection. No-op (returns null) when Calendar access is not granted, so a
 * signed-in owner who only used Google for something else is never marked
 * connected. The display identity is sourced from the linked Google account, and
 * the `connect` callback is the owner-scoped product mutation.
 */
export async function reconcileGoogleCalendarConnection(input: {
  ownerUserId: string;
  accounts: readonly LinkedAccountLike[];
  connect: ConnectCalendarFn;
}): Promise<unknown | null> {
  const derived = deriveCalendarConnection(input.accounts);
  if (!derived) {
    return null;
  }
  return input.connect({
    ownerUserId: input.ownerUserId,
    providerKey: PROVIDER_GOOGLE,
    capabilityKey: GOOGLE_CALENDAR_CAPABILITY,
    displayIdentity: derived.displayIdentity,
    authorizedScopes: derived.authorizedScopes,
  });
}

export { GOOGLE_CALENDAR_EVENTS_READONLY_SCOPE };
