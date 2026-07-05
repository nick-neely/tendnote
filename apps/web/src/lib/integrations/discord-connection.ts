import { DISCORD_IDENTIFY_SCOPE, PROVIDER_DISCORD } from "@tendnote/domain";

/**
 * Reconcile Better Auth Discord account-link state into the owner's Discord
 * identity mapping and Provider Connection (ADR-0138).
 *
 * Two owner-scoped writes back the single link:
 *  1. the persisted `discord_identities` mapping (#166) that inbound Discord
 *     interactions resolve against, and
 *  2. the non-secret Discord Provider Connection the account page reads.
 *
 * Better Auth owns OAuth token custody; this only mirrors NON-SECRET state. The
 * stable resolution key is the Discord user id (`accountId`), never an email — so
 * phone-only / no-email Discord accounts link cleanly. For a human-verifiable
 * display the reconcile resolves the Discord username at link time (see
 * `fetchUsername`) and stores it as the connection's display identity.
 *
 * Pure (no Better Auth, next, or DB imports) so the derivation and conflict rules
 * are unit-testable; the server glue that lists accounts, fetches the username, and
 * persists lives in the server-only `provider-connections` boundary.
 */

export const DISCORD_CHANNEL_CAPABILITY = "channel" as const;

/**
 * Shown when the linked Discord user is already mapped to a DIFFERENT Tendnote
 * owner. Reassignment is never a silent side effect (#166), so the connection is
 * surfaced as needing attention rather than stealing the mapping.
 */
export const DISCORD_IDENTITY_CONFLICT_MESSAGE =
  "This Discord account is linked to a different Tendnote account. Disconnect it there first, " +
  "or remove Tendnote under Discord Settings → Authorized Apps, then connect again.";

/** Shape Better Auth's `listUserAccounts` returns, narrowed to what we read. */
export type LinkedDiscordAccountLike = {
  providerId?: string | null;
  provider?: string | null;
  /** The provider's user id — for Discord this is the stable Discord user id. */
  accountId?: string | null;
  scopes?: readonly string[] | null;
  scope?: string | null;
};

/** Parse a granted-scope value (string[] or space/comma-separated string). */
export function parseDiscordScopes(account: LinkedDiscordAccountLike): string[] {
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

/**
 * Whether a Better Auth linked account is the Discord provider. Coalesces the two
 * provider-key shapes (`providerId` from `listUserAccounts`, `provider` elsewhere) in
 * one place so the derivation and the after-link hook filter agree on the rule.
 */
export function isDiscordAccount(account: LinkedDiscordAccountLike): boolean {
  return (account.providerId ?? account.provider) === PROVIDER_DISCORD;
}

export type DerivedDiscordConnection = {
  /** The linked Discord user id — the identity inbound interactions resolve on. */
  discordUserId: string;
  authorizedScopes: string[];
};

/**
 * Derive the owner's linked Discord account from their Better Auth accounts, or
 * `null` when no Discord account is linked (nothing to connect). Returns the Discord
 * user id — the value the Discord channel owner resolver keys on — and the granted
 * scopes; the human-facing display identity is resolved separately at link time.
 */
export function deriveDiscordConnection(
  accounts: readonly LinkedDiscordAccountLike[],
): DerivedDiscordConnection | null {
  for (const account of accounts) {
    if (!isDiscordAccount(account)) {
      continue;
    }
    const discordUserId = account.accountId;
    if (typeof discordUserId !== "string" || discordUserId.length === 0) {
      continue;
    }
    const scopes = parseDiscordScopes(account);
    return {
      discordUserId,
      // Sorted so the mirrored value is order-stable across provider responses,
      // keeping the connection idempotent rather than rewriting on every reconcile.
      authorizedScopes: scopes.length > 0 ? [...scopes].sort() : [DISCORD_IDENTIFY_SCOPE],
    };
  }
  return null;
}

/**
 * The account-page display identity for a linked Discord account. Prefer the
 * human-verifiable Discord username/global name; when it cannot be resolved, fall
 * back to a clearly labeled id rather than a bare, unrecognizable snowflake.
 */
export function formatDiscordDisplayIdentity(
  username: string | null | undefined,
  discordUserId: string,
): string {
  const trimmed = username?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : `Discord ID: ${discordUserId}`;
}

type DiscordCapabilityRef = {
  ownerUserId: string;
  providerKey: string;
  capabilityKey: string;
};

export type LinkDiscordIdentityFn = (input: {
  ownerUserId: string;
  discordUserId: string;
  displayIdentity?: string | null;
}) => Promise<void>;

export type ConnectDiscordFn = (
  input: DiscordCapabilityRef & {
    displayIdentity?: string | null;
    authorizedScopes?: string[] | null;
  },
) => Promise<void>;

type RecordConnectionErrorFn = (input: DiscordCapabilityRef & { message: string }) => Promise<void>;

/** The persisted owner + display identity a Discord user id currently maps to. */
export type MappedDiscordIdentity = {
  ownerUserId: string;
  displayIdentity: string | null;
};

/**
 * Mirror the owner's Better Auth Discord account-link into their persisted Discord
 * identity mapping and Provider Connection. No-op when no Discord account is linked.
 *
 * Ownership rules (#166): a Discord user id already mapped to a DIFFERENT owner is
 * never reassigned — the connection is recorded as an actionable conflict error
 * instead. This covers both the pre-checked case and the race where another owner
 * claims the mapping between the pre-check and the write (the persisted mapping's
 * reassign guard throws); the throw is re-checked and surfaced as the same conflict
 * rather than escaping to the caller's best-effort catch, where it would vanish.
 *
 * `getIdentity` returns the mapping a Discord user id currently resolves to (owner +
 * stored display identity), or null. It gates work: an existing mapping owned by
 * this owner is steady state — the stored display identity is re-mirrored with no
 * re-link and no `fetchUsername` network call. A missing mapping is a fresh link:
 * `fetchUsername` resolves a human-readable identity once, then the mapping and
 * connection are written.
 */
export async function reconcileDiscordConnection(input: {
  ownerUserId: string;
  accounts: readonly LinkedDiscordAccountLike[];
  getIdentity: (discordUserId: string) => Promise<MappedDiscordIdentity | null>;
  fetchUsername: () => Promise<string | null>;
  linkIdentity: LinkDiscordIdentityFn;
  connect: ConnectDiscordFn;
  recordError?: RecordConnectionErrorFn;
}): Promise<void> {
  const ref: DiscordCapabilityRef = {
    ownerUserId: input.ownerUserId,
    providerKey: PROVIDER_DISCORD,
    capabilityKey: DISCORD_CHANNEL_CAPABILITY,
  };

  const derived = deriveDiscordConnection(input.accounts);
  if (!derived) {
    return;
  }

  const existing = await input.getIdentity(derived.discordUserId);
  if (existing && existing.ownerUserId !== input.ownerUserId) {
    await input.recordError?.({ ...ref, message: DISCORD_IDENTITY_CONFLICT_MESSAGE });
    return;
  }

  if (existing) {
    // Steady state: re-mirror the stored display identity. No re-link, and no
    // network fetch for the username on every account page load.
    await input.connect({
      ...ref,
      displayIdentity: existing.displayIdentity,
      authorizedScopes: derived.authorizedScopes,
    });
    return;
  }

  // Fresh link: resolve a human-readable identity once (best-effort), persist the
  // mapping, then mirror the connection.
  const displayIdentity = formatDiscordDisplayIdentity(
    await input.fetchUsername(),
    derived.discordUserId,
  );
  try {
    await input.linkIdentity({
      ownerUserId: input.ownerUserId,
      discordUserId: derived.discordUserId,
      displayIdentity,
    });
  } catch (error) {
    // Distinguish a real cross-owner race (surface the conflict) from an unrelated
    // failure (let the caller's best-effort read-path handling deal with it).
    const now = await input.getIdentity(derived.discordUserId);
    if (now && now.ownerUserId !== input.ownerUserId) {
      await input.recordError?.({ ...ref, message: DISCORD_IDENTITY_CONFLICT_MESSAGE });
      return;
    }
    throw error;
  }

  await input.connect({
    ...ref,
    displayIdentity,
    authorizedScopes: derived.authorizedScopes,
  });
}
