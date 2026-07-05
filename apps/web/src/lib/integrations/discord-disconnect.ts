import { PROVIDER_DISCORD } from "@tendnote/domain";
import { DISCORD_CHANNEL_CAPABILITY } from "./discord-connection";

/**
 * Owner-scoped Discord disconnect (ADR-0138). Disconnect does a best-effort
 * provider-side token revocation, then two authoritative steps plus the audited
 * status transition:
 *
 * 0. Best-effort revoke the linked account's Discord access token provider-side
 *    (#176), before the unlink discards token custody. Mirrors the Google disconnect
 *    posture: never blocks the disconnect, and its outcome is threaded into the
 *    audit reason (step 3) so a grant that wasn't revoked is visible in the trail.
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
  /**
   * Best-effort revoke the linked Discord access token provider-side, before the
   * authoritative unlink discards token custody. Resolves with whether the provider
   * acknowledged the revocation. Never blocks the disconnect: the implementation
   * handles/logs its own failures and surfaces them only as `false`, and this module
   * additionally swallows any rejection so the unlink / mapping-removal /
   * revoked-marking always proceed. The outcome is recorded in the audit reason.
   */
  revokeToken: () => Promise<boolean>;
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
  // Best-effort provider-side token revocation first — it needs the access token the
  // authoritative unlink below discards. Never blocks disconnect: the dep handles its
  // own failures (returning `false`), and we additionally swallow any rejection so a
  // misbehaving dep still can't stop local cleanup. The outcome feeds the audit reason.
  let providerRevoked = false;
  try {
    providerRevoked = await deps.revokeToken();
  } catch {
    providerRevoked = false;
  }

  // Authoritative first: if the unlink fails this throws and nothing below runs, so
  // we never report a disconnect we did not actually perform.
  await deps.unlinkAccount();

  // Fail-closed the channel: an unmapped Discord user creates no Tendnote context.
  const mappingRemoved = await deps.unlinkIdentity();

  // Thread the revoke outcome into the audit reason (mirrors Google, ADR-0080) so an
  // unrevoked provider-side grant is visible in the trail, not just a log line.
  await deps.markRevoked({
    ownerUserId: deps.ownerUserId,
    providerKey: PROVIDER_DISCORD,
    capabilityKey: DISCORD_CHANNEL_CAPABILITY,
    reason: providerRevoked ? "user_disconnect" : "user_disconnect_provider_grant_not_revoked",
  });

  return { mappingRemoved };
}
