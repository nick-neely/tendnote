import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The after-link hook target (#174) shares the page-load reconcile path. These tests
// drive `reconcileDiscordAfterLink` directly with the just-created account row Better
// Auth hands the `account.create.after` hook, and assert the persisted writes.

const {
  getDiscordIdentity,
  linkDiscordIdentity,
  listDiscordIdentities,
  unlinkDiscordIdentity,
  connectProviderConnection,
  recordProviderConnectionError,
  getAccessToken,
  admittedOwnerOrNull,
  updateAccountMutationScopes,
} = vi.hoisted(() => ({
  getDiscordIdentity: vi.fn(),
  linkDiscordIdentity: vi.fn(),
  listDiscordIdentities: vi.fn(),
  unlinkDiscordIdentity: vi.fn(),
  connectProviderConnection: vi.fn(),
  recordProviderConnectionError: vi.fn(),
  getAccessToken: vi.fn(),
  admittedOwnerOrNull: vi.fn(),
  updateAccountMutationScopes: vi.fn(),
}));

// `server-only` throws outside an RSC bundle; stub it so the module loads in tests.
vi.mock("server-only", () => ({}));
vi.mock("@tendnote/db/queries/discord-identities", () => ({
  getDiscordIdentity,
  linkDiscordIdentity,
  listDiscordIdentities,
  unlinkDiscordIdentity,
}));
vi.mock("@tendnote/db/queries/provider-connections", () => ({
  connectProviderConnection,
  isProviderCapabilityConnected: vi.fn(),
  listProviderConnections: vi.fn(),
  markProviderConnectionRevoked: vi.fn(),
  recordProviderConnectionError,
  setProviderConnectionStatus: vi.fn(),
}));
vi.mock("@/lib/access/current-access", () => ({
  requireAdmittedOwner: vi.fn(),
  requireAdmittedOwnerForAction: vi.fn(),
  admittedOwnerOrNull,
}));
vi.mock("@/lib/cache/account-mutation-scopes", () => ({
  accountMutationScopes: {
    forOwner: (ownerUserId: string) => [{ kind: "account-owner", ownerUserId }],
  },
  updateAccountMutationScopes,
}));
// `fetchDiscordUsername` resolves the username via Better Auth's access token; the
// account row the hook receives only carries an encrypted token, so the reconcile
// fetches a fresh one the same way the page path does.
vi.mock("@/lib/auth/server", () => ({
  getAuth: () => ({ api: { getAccessToken } }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

import { DISCORD_IDENTITY_CONFLICT_MESSAGE } from "./discord-connection";
import { reconcileDiscordAfterLink } from "./provider-connections";

const OWNER = "owner-1";
const DISCORD_USER = "111111111111111111";

function discordAccount(overrides: Record<string, unknown> = {}) {
  return {
    providerId: "discord",
    userId: OWNER,
    accountId: DISCORD_USER,
    scope: "identify",
    ...overrides,
  };
}

/** Stub the Discord `/users/@me` username fetch to resolve `global_name`. */
function mockUsername(name: string | null) {
  getAccessToken.mockResolvedValue({ accessToken: "discord-access-token" });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ global_name: name }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // The linking session resolves to this admitted owner by default; individual
  // admission-gate tests override it.
  admittedOwnerOrNull.mockResolvedValue(OWNER);
  // isDiscordConfigured reads these from the environment.
  process.env.DISCORD_CLIENT_ID = "test-client-id";
  process.env.DISCORD_CLIENT_SECRET = "test-client-secret";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DISCORD_CLIENT_ID;
  delete process.env.DISCORD_CLIENT_SECRET;
});

describe("reconcileDiscordAfterLink", () => {
  it("writes the identity mapping and connection on a fresh link", async () => {
    getDiscordIdentity.mockResolvedValue(null);
    mockUsername("Cool Name");

    await reconcileDiscordAfterLink(discordAccount());

    expect(linkDiscordIdentity).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      discordUserId: DISCORD_USER,
      displayIdentity: "Cool Name",
    });
    expect(connectProviderConnection).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      providerKey: "discord",
      capabilityKey: "channel",
      displayIdentity: "Cool Name",
      authorizedScopes: ["identify"],
    });
    expect(recordProviderConnectionError).not.toHaveBeenCalled();
    expect(updateAccountMutationScopes).toHaveBeenCalledWith([
      { kind: "account-owner", ownerUserId: OWNER },
    ]);
  });

  it("is a no-op re-mirror when the identity is already current — no re-link, no username fetch", async () => {
    getDiscordIdentity.mockResolvedValue({ ownerUserId: OWNER, displayIdentity: "Stored Name" });

    await reconcileDiscordAfterLink(discordAccount());

    // Steady state: the stored display identity is re-mirrored without a re-link or a
    // network fetch for the username.
    expect(linkDiscordIdentity).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(connectProviderConnection).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      providerKey: "discord",
      capabilityKey: "channel",
      displayIdentity: "Stored Name",
      authorizedScopes: ["identify"],
    });
  });

  it("records a cross-owner conflict instead of stealing the mapping", async () => {
    getDiscordIdentity.mockResolvedValue({ ownerUserId: "other-owner", displayIdentity: "Theirs" });

    await reconcileDiscordAfterLink(discordAccount());

    expect(recordProviderConnectionError).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      providerKey: "discord",
      capabilityKey: "channel",
      message: DISCORD_IDENTITY_CONFLICT_MESSAGE,
    });
    expect(linkDiscordIdentity).not.toHaveBeenCalled();
    expect(connectProviderConnection).not.toHaveBeenCalled();
  });

  it("ignores non-Discord account links", async () => {
    await reconcileDiscordAfterLink({ providerId: "github", userId: OWNER, accountId: "gh-1" });

    expect(getDiscordIdentity).not.toHaveBeenCalled();
    expect(linkDiscordIdentity).not.toHaveBeenCalled();
    expect(connectProviderConnection).not.toHaveBeenCalled();
  });

  it("is inert when Discord is not configured", async () => {
    delete process.env.DISCORD_CLIENT_ID;
    delete process.env.DISCORD_CLIENT_SECRET;

    await reconcileDiscordAfterLink(discordAccount());

    expect(getDiscordIdentity).not.toHaveBeenCalled();
  });

  it("skips (writes nothing) when the linking user is not admitted", async () => {
    // A pending/non-admitted user can drive linkSocial directly; the gate must stop
    // the hook from minting a resolvable Discord identity for them.
    admittedOwnerOrNull.mockResolvedValue(null);
    getDiscordIdentity.mockResolvedValue(null);
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    await reconcileDiscordAfterLink(discordAccount());

    expect(getDiscordIdentity).not.toHaveBeenCalled();
    expect(linkDiscordIdentity).not.toHaveBeenCalled();
    expect(connectProviderConnection).not.toHaveBeenCalled();
    expect(consoleInfo).toHaveBeenCalled();

    consoleInfo.mockRestore();
  });

  it("skips when the admitted session owner is not the linked account's owner", async () => {
    // Defense in depth: reconcile only for the admitted owner that owns this account,
    // never a different admitted owner.
    admittedOwnerOrNull.mockResolvedValue("someone-else");
    getDiscordIdentity.mockResolvedValue(null);
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    await reconcileDiscordAfterLink(discordAccount());

    expect(linkDiscordIdentity).not.toHaveBeenCalled();
    expect(connectProviderConnection).not.toHaveBeenCalled();

    consoleInfo.mockRestore();
  });

  it("swallows an unexpected failure so the OAuth callback never fails", async () => {
    getDiscordIdentity.mockResolvedValue(null);
    mockUsername("Cool Name");
    connectProviderConnection.mockRejectedValue(new Error("db unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    // Must resolve (not reject): the after-link hook is best-effort; the /account
    // backstop recovers.
    await expect(reconcileDiscordAfterLink(discordAccount())).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
