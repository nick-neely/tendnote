import "server-only";

import {
  getDiscordIdentity,
  linkDiscordIdentity,
  listDiscordIdentities,
  unlinkDiscordIdentity,
} from "@tendnote/db/queries/discord-identities";
import {
  connectProviderConnection,
  isProviderCapabilityConnected,
  listProviderConnections,
  markProviderConnectionRevoked,
  recordProviderConnectionError,
  setProviderConnectionStatus,
} from "@tendnote/db/queries/provider-connections";
import type { ProviderConnectionStatus } from "@tendnote/domain";
import { requireAdmittedOwner, requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import {
  discordEnvFromProcess,
  googleEnvFromProcess,
  isDiscordConfigured,
  isGoogleConfigured,
} from "@/lib/auth/social";
import { deriveDiscordConnection, reconcileDiscordConnection } from "./discord-connection";
import { type DisconnectDiscordResult, disconnectDiscord } from "./discord-disconnect";
import { reconcileGoogleCalendarConnection } from "./google-calendar-connection";
import {
  type DisconnectGoogleCalendarResult,
  disconnectGoogleCalendar,
} from "./google-calendar-disconnect";
import { reconcileGoogleContactsConnection } from "./google-contacts-connection";
import { reconcileGoogleGmailConnection } from "./google-gmail-connection";

const GOOGLE_OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const DISCORD_USER_INFO_URL = "https://discord.com/api/users/@me";

/**
 * Lazily load the RSC-only Better Auth server + request headers together. Kept in
 * one place so this module stays inert (and its unit tests stay deterministic) until
 * a request actually needs them, rather than importing next/headers at module load.
 */
async function loadAuthContext() {
  const [{ getAuth }, { headers }] = await Promise.all([
    import("@/lib/auth/server"),
    import("next/headers"),
  ]);
  return { auth: getAuth(), requestHeaders: await headers() };
}

/** The owner's Better Auth linked accounts (providerId + accountId + granted scopes). */
async function listOwnerLinkedAccounts() {
  const { auth, requestHeaders } = await loadAuthContext();
  return (await auth.api.listUserAccounts({ headers: requestHeaders })) ?? [];
}

/**
 * Best-effort resolve the linked Discord account's username/global name via
 * `/users/@me`, for a human-verifiable display identity. Uses the owner's Better
 * Auth access token; returns null on any failure (missing token, network, non-2xx)
 * so a fresh link still records a clearly-labeled id fallback rather than failing.
 */
async function fetchDiscordUsername(): Promise<string | null> {
  try {
    const { auth, requestHeaders } = await loadAuthContext();
    const token = await auth.api.getAccessToken({
      body: { providerId: "discord" },
      headers: requestHeaders,
    });
    const accessToken = (token as { accessToken?: string } | null)?.accessToken;
    if (!accessToken) {
      return null;
    }
    const response = await fetch(DISCORD_USER_INFO_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      return null;
    }
    const profile = (await response.json()) as {
      username?: string | null;
      global_name?: string | null;
    };
    return profile.global_name?.trim() || profile.username?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Hosted product boundary for reading Provider Connection state (#100, ADR-0069).
 *
 * Resolves the admitted owner first, so pending-access and unauthenticated users
 * are redirected/denied before any connection state is read. This is the single
 * entry point the account page and future settings routes use; it never bypasses
 * the admitted-access gate.
 */
export async function getOwnerProviderConnections() {
  const ownerUserId = await requireAdmittedOwner();
  // Mirror live Google account-link state into the Calendar connection before
  // reading, so returning from the linkSocial flow shows `connected` (ADR-0071).
  // This is a read-path write by design: the mirror is owner-scoped (it persists
  // only for the just-resolved admitted owner, from that same session's accounts)
  // and idempotent (no row change ⇒ no audit entry), so it cannot affect another
  // owner. Best-effort: a transient provider/auth hiccup must not break the
  // account page (ADR-0081), so failures are swallowed and the persisted state is
  // read as-is. Durable auth/credential error mapping lands with the read and
  // disconnect slices (#108, #109) where real provider errors surface.
  await syncGoogleConnections(ownerUserId).catch(() => {});
  // Mirror live Better Auth Discord account-link state into the Discord identity
  // mapping and Provider Connection, on the same best-effort read-path terms.
  await syncDiscordConnection(ownerUserId).catch(() => {});
  return listProviderConnections({ ownerUserId });
}

/**
 * Reconcile the owner's Better Auth Google account-link into their Calendar and
 * Gmail Provider Connections (Phase 2C/2D, ADR-0071/0090). Lists the shared Google
 * account link once, then mirrors each capability from its own granted scope, so
 * Calendar and Gmail connect independently and neither implies the other. No-op
 * unless Google is configured; the heavy/RSC-only deps (Better Auth server, request
 * headers) are imported lazily so this stays inert — and unit tests stay
 * deterministic — when Google is not wired. Identity and scopes come from the linked
 * Google account, never the session.
 */
async function syncGoogleConnections(ownerUserId: string): Promise<void> {
  if (!isGoogleConfigured(googleEnvFromProcess())) {
    return;
  }
  const accounts = await listOwnerLinkedAccounts();
  const existingConnections = await listProviderConnections({ ownerUserId });
  await Promise.all([
    reconcileGoogleCalendarConnection({
      ownerUserId,
      accounts,
      connect: connectProviderConnection,
    }),
    reconcileGoogleGmailConnection({
      ownerUserId,
      accounts,
      connect: connectProviderConnection,
      // Downgrade a stale Gmail row when the shared Google account was unlinked (e.g.
      // by a Calendar disconnect), so Gmail status stays honest (ADR-0090).
      isConnected: isProviderCapabilityConnected,
      revoke: markProviderConnectionRevoked,
    }),
    reconcileGoogleContactsConnection({
      ownerUserId,
      accounts,
      existingConnections,
      connect: connectProviderConnection,
      isConnected: isProviderCapabilityConnected,
      revoke: markProviderConnectionRevoked,
      recordError: recordProviderConnectionError,
    }),
  ]);
}

/**
 * Reconcile the owner's Better Auth Discord account-link into their persisted
 * Discord identity mapping (#166) and Discord Provider Connection. No-op unless
 * Discord is configured; heavy RSC-only deps (Better Auth server, request headers)
 * are imported lazily so this stays inert — and unit tests stay deterministic —
 * when Discord is not wired. Identity is the Discord user id from the linked
 * account, never the session, so the mapping resolves inbound interactions honestly.
 */
async function syncDiscordConnection(ownerUserId: string): Promise<void> {
  if (!isDiscordConfigured(discordEnvFromProcess())) {
    return;
  }
  const accounts = await listOwnerLinkedAccounts();
  await reconcileDiscordConnection({
    ownerUserId,
    accounts,
    getIdentity: async (discordUserId) => {
      const identity = await getDiscordIdentity({ discordUserId });
      return identity
        ? { ownerUserId: identity.ownerUserId, displayIdentity: identity.displayIdentity }
        : null;
    },
    fetchUsername: fetchDiscordUsername,
    linkIdentity: async (linkInput) => {
      await linkDiscordIdentity(linkInput);
    },
    connect: async (connectInput) => {
      await connectProviderConnection(connectInput);
    },
    recordError: async (errorInput) => {
      await recordProviderConnectionError(errorInput);
    },
  });
}

/**
 * Hosted product boundary for changing Provider Connection status. Resolves the
 * admitted owner via the action gate (which throws, failing closed, for pending or
 * unauthenticated callers) before any state is mutated, and scopes the change to
 * that owner. Phase 2B affordances stay inert; future provider slices call this.
 */
export async function setOwnerProviderConnectionStatus(input: {
  providerKey: string;
  capabilityKey: string;
  status: ProviderConnectionStatus;
}) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  return setProviderConnectionStatus({ ownerUserId, ...input });
}

/**
 * Explicit owner intent to reconnect Google Contacts after a local disconnect.
 * The read-path reconciler honors `user_disconnect` as a durable preview-read
 * block, so only the Contacts connect button clears that local opt-out before
 * starting Better Auth's narrow Contacts consent flow.
 */
export async function prepareOwnerGoogleContactsConnect() {
  const ownerUserId = await requireAdmittedOwnerForAction();
  return setProviderConnectionStatus({
    ownerUserId,
    providerKey: "google",
    capabilityKey: "contacts",
    status: "ready",
  });
}

/**
 * Hosted product boundary for disconnecting Google Calendar (Phase 2C, ADR-0080).
 * Resolves the admitted owner via the action gate, then best-effort revokes the
 * Google grant, authoritatively unlinks the Better Auth account (so reads are
 * blocked and the reconcile cannot re-connect), clears the Calendar cache, and
 * marks the Provider Connection revoked. Returns whether the user still needs to
 * finish cleanup at their Google Account permissions.
 */
export async function disconnectOwnerGoogleCalendar(): Promise<DisconnectGoogleCalendarResult> {
  const ownerUserId = await requireAdmittedOwnerForAction();

  return disconnectGoogleCalendar({
    ownerUserId,
    revokeAndUnlink: async () => {
      const { auth, requestHeaders } = await loadAuthContext();

      // Best-effort provider-side grant revocation first — it needs the access
      // token that the authoritative unlink below discards. Never throws, so an
      // unavailable Google revoke endpoint still lets local unlink/cleanup proceed
      // (ADR-0080).
      let providerRevoked = false;
      try {
        const token = await auth.api.getAccessToken({
          body: { providerId: "google" },
          headers: requestHeaders,
        });
        const accessToken = (token as { accessToken?: string } | null)?.accessToken;
        if (accessToken) {
          // Send the token in the form body (not the URL) so it cannot leak into
          // request logs (ADR-0081). Google's revoke endpoint accepts either.
          const response = await fetch(GOOGLE_OAUTH_REVOKE_URL, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token: accessToken }).toString(),
          });
          providerRevoked = response.ok;
        }
      } catch {
        providerRevoked = false;
      }

      // Authoritative: remove the account link (and its token custody). Throws on
      // failure, failing the whole disconnect rather than reporting a false success.
      await auth.api.unlinkAccount({
        body: { providerId: "google" },
        headers: requestHeaders,
      });

      return { providerRevoked };
    },
    markRevoked: markProviderConnectionRevoked,
  });
}

/**
 * Disconnect Google Contacts locally for this owner. Confirmed imported people,
 * contact methods, and birthdays are Tendnote-owned data and are intentionally not
 * deleted; the revoked Provider Connection blocks future Contacts preview reads.
 */
export async function disconnectOwnerGoogleContacts() {
  const ownerUserId = await requireAdmittedOwnerForAction();
  return markProviderConnectionRevoked({
    ownerUserId,
    providerKey: "google",
    capabilityKey: "contacts",
    reason: "user_disconnect",
  });
}

/**
 * Hosted product boundary for disconnecting Discord (ADR-0138).
 * Resolves the admitted owner via the action gate, then authoritatively unlinks the
 * Better Auth Discord account (so the reconcile cannot re-link/re-connect), removes
 * the owner's persisted Discord identity mapping (so inbound interactions fail
 * closed), and marks the Discord Provider Connection revoked. Scoped to Discord —
 * unrelated Google capabilities are untouched.
 */
export async function disconnectOwnerDiscord(): Promise<DisconnectDiscordResult> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  // Resolve the linked Discord account's id up front so the unlink targets exactly
  // that account (unambiguous if a second Discord account is ever linked).
  const linkedDiscord = deriveDiscordConnection(await listOwnerLinkedAccounts());

  return disconnectDiscord({
    ownerUserId,
    unlinkAccount: async () => {
      const { auth, requestHeaders } = await loadAuthContext();
      // Authoritative: remove the account link (and its token custody). Throws on
      // failure, failing the whole disconnect rather than reporting a false success.
      await auth.api.unlinkAccount({
        body: {
          providerId: "discord",
          ...(linkedDiscord ? { accountId: linkedDiscord.discordUserId } : {}),
        },
        headers: requestHeaders,
      });
    },
    // Owner-scoped: remove every Discord identity this owner owns. deleteOwned only
    // touches rows the owner owns, so another owner's mapping is never affected.
    unlinkIdentity: async () => {
      const owned = await listDiscordIdentities({ ownerUserId });
      let removed = false;
      for (const identity of owned) {
        const didRemove = await unlinkDiscordIdentity({
          ownerUserId,
          discordUserId: identity.discordUserId,
        });
        removed = didRemove || removed;
      }
      return removed;
    },
    markRevoked: markProviderConnectionRevoked,
  });
}
