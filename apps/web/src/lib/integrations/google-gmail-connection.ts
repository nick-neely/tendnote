import {
  GMAIL_CAPABILITY_KEY,
  GOOGLE_GMAIL_COMPOSE_SCOPE,
  hasGmailComposeScope,
  PROVIDER_GOOGLE,
} from "@tendnote/domain";
import {
  type ConnectCalendarFn,
  googleAccountIdentity,
  googleGrantedScopes,
  type LinkedAccountLike,
} from "./google-calendar-connection";

/**
 * Reconcile Better Auth Google account-link state into the owner's Gmail Provider
 * Connection (Phase 2D, ADR-0090). Gmail is a SEPARATE `google/gmail` capability
 * from `google/calendar`: one Google account can grant either capability's scope
 * independently through incremental consent, and each capability's connection
 * status is mirrored from its own granted scope. Better Auth still owns OAuth token
 * custody and refresh; this only mirrors NON-SECRET status, identity, and scopes.
 *
 * Pure (no Better Auth, next, or network imports) so the derivation is unit-
 * testable; the server glue lives in the `provider-connections` boundary. Reuses
 * the Calendar module's account-scope parsing so the two capabilities read the
 * shared Google account link the same way.
 */

export const GOOGLE_GMAIL_CAPABILITY = GMAIL_CAPABILITY_KEY;

/** Reason recorded when the shared Google account is unlinked out from under Gmail. */
export const GMAIL_ACCOUNT_UNLINKED_REASON = "google_account_unlinked";

/** Owner-scoped provider-capability reference for the Gmail connection. */
type GoogleCapabilityRef = {
  ownerUserId: string;
  providerKey: string;
  capabilityKey: string;
};

/**
 * Decide whether the owner's linked Google account grants Gmail draft-write access.
 * Returns the authorized scopes and connected Google identity to mirror, or `null`
 * when no Google account grants the Gmail compose scope (nothing to connect) — so a
 * Calendar-only owner is never marked Gmail-connected. The identity is the Google
 * account email, not the Tendnote session email.
 */
export function deriveGmailConnection(
  accounts: readonly LinkedAccountLike[],
): { authorizedScopes: string[]; displayIdentity: string | null } | null {
  const scopes = googleGrantedScopes(accounts);
  if (!hasGmailComposeScope(scopes)) {
    return null;
  }
  return { authorizedScopes: scopes, displayIdentity: googleAccountIdentity(accounts) };
}

/**
 * Mirror the owner's Google account-link state into the Gmail Provider Connection.
 * Connects when the Gmail compose scope is granted, so connecting Calendar never
 * connects Gmail and vice versa. The `connect` callback is the owner-scoped product
 * mutation, identical to the Calendar path so the two capabilities cannot fork
 * connection policy.
 *
 * When the compose scope is NOT granted, a still-connected Gmail row is downgraded
 * to revoked via the optional `revoke` callback (ADR-0090 independent status).
 * Calendar and Gmail share one Better Auth Google account, so disconnecting Calendar
 * unlinks that account out from under Gmail; without this downgrade the Gmail row
 * would go stale-connected with no live token. `listUserAccounts` is a local read,
 * so an empty/no-scope result reliably means the grant is gone (not a transient), and
 * the downgrade only fires for a currently-connected row. Returns null when there is
 * nothing to change (no scope and not connected, or no revoke wiring).
 */
export async function reconcileGoogleGmailConnection(input: {
  ownerUserId: string;
  accounts: readonly LinkedAccountLike[];
  connect: ConnectCalendarFn;
  /** Whether the Gmail capability is currently connected (for stale downgrade). */
  isConnected?: (ref: GoogleCapabilityRef) => Promise<boolean>;
  /** Revoke a stale Gmail connection whose Google account grant is gone. */
  revoke?: (ref: GoogleCapabilityRef & { reason: string }) => Promise<unknown>;
}): Promise<unknown | null> {
  const ref: GoogleCapabilityRef = {
    ownerUserId: input.ownerUserId,
    providerKey: PROVIDER_GOOGLE,
    capabilityKey: GOOGLE_GMAIL_CAPABILITY,
  };

  const derived = deriveGmailConnection(input.accounts);
  if (derived) {
    return input.connect({
      ...ref,
      displayIdentity: derived.displayIdentity,
      authorizedScopes: derived.authorizedScopes,
    });
  }

  if (input.isConnected && input.revoke && (await input.isConnected(ref))) {
    return input.revoke({ ...ref, reason: GMAIL_ACCOUNT_UNLINKED_REASON });
  }
  return null;
}

export { GOOGLE_GMAIL_COMPOSE_SCOPE };
