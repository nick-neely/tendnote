import { GOOGLE_CALENDAR_CAPABILITY } from "./google-calendar-connection";

/**
 * Owner-scoped Google Calendar disconnect (Phase 2C, ADR-0080). Disconnect does
 * real local cleanup and best-effort provider-side revocation:
 *
 * 1. Revoke the Google-side grant where possible and unlink the Better Auth
 *    account (the authoritative "stop reading" step — it removes token custody so
 *    Tendnote can no longer read AND the account-link reconcile cannot re-connect).
 * 2. Clear the owner's short-lived Calendar cache.
 * 3. Transition the Provider Connection to `revoked` with an audit entry.
 *
 * If the authoritative unlink fails the whole disconnect fails (nothing is marked
 * revoked, so the UI does not falsely claim success). If only the Google-side grant
 * revocation is incomplete, local cleanup still happens and the caller is told that
 * remaining Google Account permission cleanup is the user's to finish.
 */

const PROVIDER_KEY = "google";

/** Outcome of `revokeAndUnlink`: whether the Google-side grant was actually revoked. */
export type RevokeAndUnlinkResult = { providerRevoked: boolean };

export type DisconnectGoogleCalendarDeps = {
  ownerUserId: string;
  /**
   * Best-effort revoke the Google grant, then authoritatively unlink the Better
   * Auth account. Resolves with whether the provider-side grant was revoked;
   * rejects only if the authoritative unlink itself fails.
   */
  revokeAndUnlink: () => Promise<RevokeAndUnlinkResult>;
  /** Clear the owner's cached Calendar windows for this connection. Returns count. */
  clearCache: (ref: {
    ownerUserId: string;
    providerKey: string;
    capabilityKey: string;
  }) => Promise<number>;
  /** Mark the Provider Connection revoked with an audit-visible reason. */
  markRevoked: (input: {
    ownerUserId: string;
    providerKey: string;
    capabilityKey: string;
    reason: string;
  }) => Promise<unknown>;
};

export type DisconnectGoogleCalendarResult = {
  /** True when the Google-side grant was revoked, not just unlinked locally. */
  providerRevoked: boolean;
  /** Number of cached Calendar windows cleared. */
  cacheCleared: number;
  /** True when the user must finish cleanup at their Google Account permissions. */
  remainingCleanupRequired: boolean;
};

export async function disconnectGoogleCalendar(
  deps: DisconnectGoogleCalendarDeps,
): Promise<DisconnectGoogleCalendarResult> {
  // Authoritative step first: if the unlink fails this throws and nothing below
  // runs, so we never report a disconnect we did not actually perform.
  const { providerRevoked } = await deps.revokeAndUnlink();

  const ref = {
    ownerUserId: deps.ownerUserId,
    providerKey: PROVIDER_KEY,
    capabilityKey: GOOGLE_CALENDAR_CAPABILITY,
  };

  const cacheCleared = await deps.clearCache(ref);
  await deps.markRevoked({
    ...ref,
    reason: providerRevoked ? "user_disconnect" : "user_disconnect_provider_grant_not_revoked",
  });

  return { providerRevoked, cacheCleared, remainingCleanupRequired: !providerRevoked };
}
