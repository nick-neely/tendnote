import {
  createDiscordIdentityQueries,
  createInMemoryDiscordIdentityStore,
} from "@tendnote/db/queries/discord-identities";
import {
  createInMemoryProviderConnectionStore,
  createProviderConnectionQueries,
} from "@tendnote/db/queries/provider-connections";
import { describe, expect, it, vi } from "vitest";
import { reconcileDiscordConnection } from "./discord-connection";
import { disconnectDiscord } from "./discord-disconnect";

const OWNER = "owner-1";
const DISCORD_USER = "111111111111111111";

function deps(overrides: Partial<Parameters<typeof disconnectDiscord>[0]> = {}) {
  return {
    ownerUserId: OWNER,
    revokeToken: vi.fn().mockResolvedValue(true),
    unlinkAccount: vi.fn().mockResolvedValue(undefined),
    unlinkIdentity: vi.fn().mockResolvedValue(true),
    markRevoked: vi.fn().mockResolvedValue({ status: "revoked" }),
    ...overrides,
  };
}

describe("disconnectDiscord", () => {
  it("unlinks the account, removes the mapping, and marks the connection revoked", async () => {
    const d = deps();

    const result = await disconnectDiscord(d);

    expect(d.unlinkAccount).toHaveBeenCalledTimes(1);
    expect(d.unlinkIdentity).toHaveBeenCalledTimes(1);
    expect(d.markRevoked).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      providerKey: "discord",
      capabilityKey: "channel",
      reason: "user_disconnect",
    });
    expect(result).toEqual({ mappingRemoved: true });
  });

  it("revokes the provider-side token before unlinking (which discards the token)", async () => {
    const revokeToken = vi.fn().mockResolvedValue(true);
    const unlinkAccount = vi.fn().mockResolvedValue(undefined);
    const d = deps({ revokeToken, unlinkAccount });

    await disconnectDiscord(d);

    expect(revokeToken).toHaveBeenCalledTimes(1);
    // The revoke needs the still-linked account's token, so it must run first.
    const [revokeOrder] = revokeToken.mock.invocationCallOrder;
    const [unlinkOrder] = unlinkAccount.mock.invocationCallOrder;
    expect(revokeOrder).toBeLessThan(unlinkOrder ?? 0);
  });

  it("still fully disconnects when the provider-side token revoke rejects", async () => {
    const d = deps({ revokeToken: vi.fn().mockRejectedValue(new Error("revoke failed")) });

    const result = await disconnectDiscord(d);

    // Best-effort revoke: its failure never blocks the authoritative unlink, the
    // mapping removal, or the revoked-marking.
    expect(d.unlinkAccount).toHaveBeenCalledTimes(1);
    expect(d.unlinkIdentity).toHaveBeenCalledTimes(1);
    // The unrevoked grant is recorded in the audit reason, not just swallowed.
    expect(d.markRevoked).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "user_disconnect_provider_grant_not_revoked" }),
    );
    expect(result).toEqual({ mappingRemoved: true });
  });

  it("records the unrevoked-grant audit reason when the provider revoke returns false", async () => {
    const d = deps({ revokeToken: vi.fn().mockResolvedValue(false) });

    const result = await disconnectDiscord(d);

    expect(d.markRevoked).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "user_disconnect_provider_grant_not_revoked" }),
    );
    expect(result).toEqual({ mappingRemoved: true });
  });

  it("fails closed when the authoritative unlink fails: no mapping removal, no revoke", async () => {
    const d = deps({ unlinkAccount: vi.fn().mockRejectedValue(new Error("unlink failed")) });

    await expect(disconnectDiscord(d)).rejects.toThrow("unlink failed");
    expect(d.unlinkIdentity).not.toHaveBeenCalled();
    expect(d.markRevoked).not.toHaveBeenCalled();
  });

  it("scopes revocation to the disconnecting owner", async () => {
    const d = deps({ ownerUserId: "owner-2" });

    await disconnectDiscord(d);

    expect(d.markRevoked).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: "owner-2" }));
  });

  it("blocks inbound resolution and stays revoked: after disconnect, a reconcile with no linked account does not re-connect", async () => {
    // Drive the real product mutations end-to-end so the block is exercised against
    // the actual identity + connection stores, not fakes.
    const identityStore = createInMemoryDiscordIdentityStore();
    const identities = createDiscordIdentityQueries(identityStore);
    const connectionStore = createInMemoryProviderConnectionStore();
    const connections = createProviderConnectionQueries(connectionStore);
    const ref = { ownerUserId: OWNER, providerKey: "discord", capabilityKey: "channel" };

    // A real connected Discord identity + connection.
    await identities.linkDiscordIdentity({ ownerUserId: OWNER, discordUserId: DISCORD_USER });
    await connections.connectProviderConnection({ ...ref, displayIdentity: DISCORD_USER });
    expect(await identities.resolveOwnerUserId({ discordUserId: DISCORD_USER })).toBe(OWNER);
    expect(await connections.isProviderCapabilityConnected(ref)).toBe(true);

    await disconnectDiscord({
      ownerUserId: OWNER,
      revokeToken: vi.fn().mockResolvedValue(true),
      unlinkAccount: vi.fn().mockResolvedValue(undefined),
      unlinkIdentity: async () => {
        const owned = await identities.listDiscordIdentities({ ownerUserId: OWNER });
        let removed = false;
        for (const identity of owned) {
          removed =
            (await identities.unlinkDiscordIdentity({
              ownerUserId: OWNER,
              discordUserId: identity.discordUserId,
            })) || removed;
        }
        return removed;
      },
      markRevoked: connections.markProviderConnectionRevoked,
    });

    // Inbound Discord resolution now fails closed, and the connection read-gate refuses.
    expect(await identities.resolveOwnerUserId({ discordUserId: DISCORD_USER })).toBeNull();
    expect(await connections.isProviderCapabilityConnected(ref)).toBe(false);

    // The Better Auth account is unlinked, so the reconcile sees no Discord account
    // and must NOT re-link the identity or re-connect.
    await reconcileDiscordConnection({
      ownerUserId: OWNER,
      accounts: [],
      getIdentity: async (discordUserId) => {
        const identity = await identities.getDiscordIdentity({ discordUserId });
        return identity
          ? { ownerUserId: identity.ownerUserId, displayIdentity: identity.displayIdentity }
          : null;
      },
      fetchUsername: async () => null,
      linkIdentity: async (input) => {
        await identities.linkDiscordIdentity(input);
      },
      connect: async (input) => {
        await connections.connectProviderConnection(input);
      },
    });

    expect(await identities.resolveOwnerUserId({ discordUserId: DISCORD_USER })).toBeNull();
    expect(await connections.isProviderCapabilityConnected(ref)).toBe(false);
  });
});
