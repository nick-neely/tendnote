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
import { PROVIDER_DISCORD, PROVIDER_GOOGLE, type ProviderConnectionStatus } from "@tendnote/domain";
import {
  admittedOwnerOrNull,
  requireAdmittedOwner,
  requireAdmittedOwnerForAction,
} from "@/lib/access/current-access";
import {
  discordEnvFromProcess,
  googleEnvFromProcess,
  isDiscordConfigured,
  isGoogleConfigured,
} from "@/lib/auth/social";
import {
  accountMutationScopes,
  updateAccountMutationScopes,
} from "@/lib/cache/account-mutation-scopes";
import {
  type CapabilityReconcileContext,
  type LinkedProviderAccount,
  reconcileOwnerCapabilities,
} from "./capability-lifecycle";
import {
  deriveDiscordConnection,
  isDiscordAccount,
  type LinkedDiscordAccountLike,
} from "./discord-connection";
import { type DisconnectDiscordResult, disconnectDiscord } from "./discord-disconnect";
import { revokeDiscordTokenBestEffort } from "./discord-revoke";
import {
  type DisconnectGoogleCalendarResult,
  disconnectGoogleCalendar,
} from "./google-calendar-disconnect";

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
 * Best-effort read the owner's decrypted access token for a linked provider via
 * Better Auth (the account row stores it encrypted at rest, #174). Returns null when
 * no token is available. Shared by the username lookup and the disconnect revoke
 * paths so the `getAccessToken` shape/cast lives in exactly one place.
 */
async function getProviderAccessToken(providerId: string): Promise<string | null> {
  const { auth, requestHeaders } = await loadAuthContext();
  const token = await auth.api.getAccessToken({
    body: { providerId },
    headers: requestHeaders,
  });
  return (token as { accessToken?: string } | null)?.accessToken ?? null;
}

/**
 * Best-effort resolve the linked Discord account's username/global name via
 * `/users/@me`, for a human-verifiable display identity. Uses the owner's Better
 * Auth access token; returns null on any failure (missing token, network, non-2xx)
 * so a fresh link still records a clearly-labeled id fallback rather than failing.
 */
async function fetchDiscordUsername(): Promise<string | null> {
  try {
    const accessToken = await getProviderAccessToken("discord");
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
  // Mirror live provider account-link state into each capability's connection before
  // reading, so returning from the linkSocial flow shows `connected` (ADR-0071/0138).
  // This is a read-path write by design: the mirror is owner-scoped (it persists only
  // for the just-resolved admitted owner, from that same session's accounts) and
  // idempotent (no row change ⇒ no audit entry), so it cannot affect another owner.
  // Best-effort: a transient provider/auth hiccup must not break the account page
  // (ADR-0081), so per-capability failures are swallowed and the persisted state is
  // read as-is.
  await reconcileOwnerProviderConnections(ownerUserId).catch(() => {});
  return listProviderConnections({ ownerUserId });
}

/** Providers whose server credentials are configured, per their env gate. */
function enabledProviders(): Set<string> {
  const providers = new Set<string>();
  if (isGoogleConfigured(googleEnvFromProcess())) {
    providers.add(PROVIDER_GOOGLE);
  }
  if (isDiscordConfigured(discordEnvFromProcess())) {
    providers.add(PROVIDER_DISCORD);
  }
  return providers;
}

/**
 * Build the reconcile context that binds the catalog's capability lifecycle registry to
 * production write deps (ADR-0069/0071/0090/0138). Every capability's reconcile draws
 * from this one context: the shared Better Auth linked-account list read once, the
 * owner-scoped connect/revoke/error mutations, and the Discord identity resolvers.
 * Identity and scopes always come from the linked provider account, never the session,
 * so a mirrored connection honestly reflects which account it reads. Heavy RSC-only
 * deps (Better Auth server, request headers) load lazily inside the injected callbacks.
 */
function buildReconcileContext(input: {
  ownerUserId: string;
  accounts: readonly LinkedProviderAccount[];
  existingConnections: CapabilityReconcileContext["existingConnections"];
  enabled: ReadonlySet<string>;
}): CapabilityReconcileContext {
  return {
    ownerUserId: input.ownerUserId,
    accounts: input.accounts,
    existingConnections: input.existingConnections,
    enabledProviders: input.enabled,
    connect: connectProviderConnection,
    isConnected: isProviderCapabilityConnected,
    revoke: markProviderConnectionRevoked,
    recordError: recordProviderConnectionError,
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
  };
}

/**
 * Reconcile every offered capability (Calendar, Gmail, Contacts, Discord) from the
 * owner's live provider account-links, driven by the catalog lifecycle registry. Lists
 * the shared linked-account set once and mirrors each capability from its own granted
 * scope / identity, so Calendar, Gmail, and Contacts connect independently and Discord
 * links its owner-scoped identity — each behind its own explicit adapter. No-op when no
 * provider is configured, so this stays inert (and unit tests stay deterministic) until
 * a provider is wired. Per-capability failures are isolated so one provider's transient
 * failure never blocks another's mirror.
 */
async function reconcileOwnerProviderConnections(ownerUserId: string): Promise<void> {
  const enabled = enabledProviders();
  if (enabled.size === 0) {
    return;
  }
  const [accounts, existingConnections] = await Promise.all([
    listOwnerLinkedAccounts(),
    listProviderConnections({ ownerUserId }),
  ]);
  await reconcileOwnerCapabilities(
    buildReconcileContext({ ownerUserId, accounts, existingConnections, enabled }),
  );
}

/**
 * Better Auth `account.create.after` hook target (#174, ADR-0138): reconcile a
 * freshly linked Discord account into its identity mapping + Provider Connection
 * immediately, instead of waiting for the next /account load. Runs the same shared
 * reconcile as the page-load path from the just-created account row — the owner and
 * Discord user id come straight off the hook payload, so no session round-trip is
 * needed — keeping both paths idempotent and the page load a self-healing backstop.
 *
 * Non-Discord account links (GitHub sign-in, Google linking) are ignored. A
 * cross-owner conflict is still recorded as an actionable error by the reconcile (not
 * swallowed). Any unexpected failure is caught and logged rather than thrown: the
 * OAuth callback/redirect must never fail on this best-effort mirror, and the
 * /account backstop still recovers.
 *
 * Admission gate: the hook fires on ANY authenticated linkSocial, but Better Auth's
 * `/link-social` endpoint only requires a session — not Private Beta admission — so a
 * pending (authenticated, non-admitted) user could drive the Discord link directly
 * and, without this gate, get a resolvable `discord_identities` mapping the agent
 * capture path would honor. The page path is safe because it resolves the admitted
 * owner first (`requireAdmittedOwner`); the hook must match that. It resolves the
 * admitted owner from the linking session and reconciles only when that is this
 * account's owner — failing closed (skip + log) otherwise. The /account backstop,
 * itself admitted-gated, reconciles later if the user is admitted afterward.
 */
export async function reconcileDiscordAfterLink(
  account: LinkedDiscordAccountLike & {
    userId?: string | null;
  },
): Promise<void> {
  if (!isDiscordAccount(account)) {
    return;
  }
  const ownerUserId = account.userId;
  if (typeof ownerUserId !== "string" || ownerUserId.length === 0) {
    return;
  }
  // Same configured-provider gate as the page-load path: no Discord credentials ⇒ no
  // mirror. Sourced from `enabledProviders()` so the two paths share one gate rather
  // than restating the `isDiscordConfigured` check.
  const enabled = enabledProviders();
  if (!enabled.has(PROVIDER_DISCORD)) {
    return;
  }
  try {
    if ((await admittedOwnerOrNull()) !== ownerUserId) {
      console.info("[tendnote] Skipped Discord after-link reconcile for a non-admitted owner");
      return;
    }
    // Same catalog-driven reconcile as the page-load path, scoped to Discord: the
    // just-created account row is the only linked account, and the reconcile is scoped
    // to Discord, so no other capability runs. The reconcile records a cross-owner
    // conflict as an actionable error itself; an unexpected reconcile failure is isolated
    // and logged via `onError`, so the OAuth callback/redirect never fails on this
    // best-effort mirror.
    await reconcileOwnerCapabilities(
      buildReconcileContext({
        ownerUserId,
        accounts: [account],
        existingConnections: [],
        enabled: new Set([PROVIDER_DISCORD]),
      }),
      {
        onError: (_ref, error) =>
          console.error("[tendnote] Discord after-link reconcile failed", error),
      },
    );
    // The Better Auth hook runs outside a Server Action. Its owner-scoped
    // connection/identity writes must make the next Account request fresh.
    updateAccountMutationScopes(accountMutationScopes.forOwner(ownerUserId));
  } catch (error) {
    // Guards the pre-reconcile admission check (`admittedOwnerOrNull`); reconcile errors
    // are handled by `onError` above, so this is a distinct failure surface.
    console.error("[tendnote] Discord after-link admission check failed", error);
  }
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
      // Best-effort provider-side grant revocation first — it needs the access
      // token that the authoritative unlink below discards. Never throws, so an
      // unavailable Google revoke endpoint still lets local unlink/cleanup proceed
      // (ADR-0080).
      let providerRevoked = false;
      try {
        const accessToken = await getProviderAccessToken("google");
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
      const { auth, requestHeaders } = await loadAuthContext();
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
    // Best-effort provider-side token revocation (#176), mirroring the Google
    // disconnect. Reads the linked account's decrypted access token ONLY for this
    // revoke call (no new token custody), and runs before the unlink below discards
    // the account. `revokeDiscordTokenBestEffort` owns the failure handling and its
    // logging, so the pure disconnect layer stays log-free while the revoke outcome
    // flows into the audit reason.
    revokeToken: () =>
      revokeDiscordTokenBestEffort({
        env: discordEnvFromProcess(),
        getAccessToken: () => getProviderAccessToken("discord"),
      }),
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
