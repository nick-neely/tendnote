import { PROVIDER_DISCORD } from "@tendnote/domain";
import { DISCORD_CHANNEL_CAPABILITY } from "./discord-connection";

/**
 * Owner-scoped Discord disconnect (ADR-0138). Disconnect does
 * two authoritative steps plus the audited status transition:
 *
 * 1. Unlink the Better Auth Discord account — removes token custody AND stops the
 *    account-link reconcile from re-linking the identity / re-connecting. This is
 *    the authoritative step: if it fails the whole disconnect fails, so the UI
 *    never claims a disconnect that did not happen.
 * 2. Remove the owner's persisted Discord identity mapping (#166), so inbound
 *    Discord interactions stop resolving to this owner and fail closed.
 * 3. Transition the Discord Provider Connection to `revoked` with an audit entry.
 *
 * Disconnect never touches Google (or any other provider) capabilities — it is
 * scoped to the Discord provider/capability only.
 */

export type DisconnectDiscordDeps = {
  ownerUserId: string;
  /** Authoritatively unlink the Better Auth Discord account. Rejects on failure. */
  unlinkAccount: () => Promise<void>;
  /**
   * Remove the owner's persisted Discord identity mapping(s). Owner-scoped, so it
   * only removes rows this owner owns. Resolves with whether a mapping was removed.
   */
  unlinkIdentity: () => Promise<boolean>;
  /** Mark the Discord Provider Connection revoked with an audit-visible reason. */
  markRevoked: (input: {
    ownerUserId: string;
    providerKey: string;
    capabilityKey: string;
    reason: string;
  }) => Promise<unknown>;
};

export type DisconnectDiscordResult = {
  /** True when a persisted Discord identity mapping was actually removed. */
  mappingRemoved: boolean;
};

export async function disconnectDiscord(
  deps: DisconnectDiscordDeps,
): Promise<DisconnectDiscordResult> {
  // Authoritative first: if the unlink fails this throws and nothing below runs, so
  // we never report a disconnect we did not actually perform.
  await deps.unlinkAccount();

  // Fail-closed the channel: an unmapped Discord user creates no Tendnote context.
  const mappingRemoved = await deps.unlinkIdentity();

  await deps.markRevoked({
    ownerUserId: deps.ownerUserId,
    providerKey: PROVIDER_DISCORD,
    capabilityKey: DISCORD_CHANNEL_CAPABILITY,
    reason: "user_disconnect",
  });

  return { mappingRemoved };
}
