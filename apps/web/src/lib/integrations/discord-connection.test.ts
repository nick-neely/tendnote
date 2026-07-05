import { DISCORD_IDENTIFY_SCOPE } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import {
  DISCORD_IDENTITY_CONFLICT_MESSAGE,
  deriveDiscordConnection,
  formatDiscordDisplayIdentity,
  type MappedDiscordIdentity,
  parseDiscordScopes,
  reconcileDiscordConnection,
} from "./discord-connection";

const OWNER = "owner-1";
const DISCORD_USER = "111111111111111111";

describe("parseDiscordScopes", () => {
  it("reads an array of scopes", () => {
    expect(parseDiscordScopes({ providerId: "discord", scopes: [DISCORD_IDENTIFY_SCOPE] })).toEqual(
      [DISCORD_IDENTIFY_SCOPE],
    );
  });

  it("splits a space- or comma-separated scope string", () => {
    expect(parseDiscordScopes({ providerId: "discord", scope: "identify email" })).toEqual([
      "identify",
      "email",
    ]);
  });
});

describe("deriveDiscordConnection", () => {
  it("returns the Discord user id and granted scopes when linked", () => {
    const accounts = [
      { providerId: "discord", accountId: DISCORD_USER, scopes: [DISCORD_IDENTIFY_SCOPE] },
    ];
    expect(deriveDiscordConnection(accounts)).toEqual({
      discordUserId: DISCORD_USER,
      authorizedScopes: [DISCORD_IDENTIFY_SCOPE],
    });
  });

  it("falls back to the identify scope so the mirror is never scope-less", () => {
    const accounts = [{ providerId: "discord", accountId: DISCORD_USER, scopes: [] }];
    expect(deriveDiscordConnection(accounts)?.authorizedScopes).toEqual([DISCORD_IDENTIFY_SCOPE]);
  });

  it("returns null when there is no linked Discord account", () => {
    expect(deriveDiscordConnection([{ providerId: "google", accountId: "g-1" }])).toBeNull();
    expect(deriveDiscordConnection([])).toBeNull();
  });

  it("ignores a Discord account with no account id", () => {
    expect(deriveDiscordConnection([{ providerId: "discord", accountId: null }])).toBeNull();
  });
});

describe("formatDiscordDisplayIdentity", () => {
  it("prefers a human-readable username", () => {
    expect(formatDiscordDisplayIdentity("Nick Neely", DISCORD_USER)).toBe("Nick Neely");
  });

  it("falls back to a clearly labeled id when no username is available", () => {
    expect(formatDiscordDisplayIdentity(null, DISCORD_USER)).toBe(`Discord ID: ${DISCORD_USER}`);
    expect(formatDiscordDisplayIdentity("  ", DISCORD_USER)).toBe(`Discord ID: ${DISCORD_USER}`);
  });
});

describe("reconcileDiscordConnection", () => {
  function deps(overrides: Partial<Parameters<typeof reconcileDiscordConnection>[0]> = {}) {
    return {
      ownerUserId: OWNER,
      accounts: [
        { providerId: "discord", accountId: DISCORD_USER, scopes: [DISCORD_IDENTIFY_SCOPE] },
      ],
      getIdentity: vi
        .fn<(id: string) => Promise<MappedDiscordIdentity | null>>()
        .mockResolvedValue(null),
      fetchUsername: vi.fn<() => Promise<string | null>>().mockResolvedValue("nickneely"),
      linkIdentity: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      recordError: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it("links the identity with the fetched username and mirrors the connection on a fresh link", async () => {
    const d = deps();

    await reconcileDiscordConnection(d);

    expect(d.fetchUsername).toHaveBeenCalledTimes(1);
    expect(d.linkIdentity).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      discordUserId: DISCORD_USER,
      displayIdentity: "nickneely",
    });
    expect(d.connect).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      providerKey: "discord",
      capabilityKey: "channel",
      displayIdentity: "nickneely",
      authorizedScopes: [DISCORD_IDENTIFY_SCOPE],
    });
    expect(d.recordError).not.toHaveBeenCalled();
  });

  it("stores a clearly-labeled id when the username cannot be fetched", async () => {
    const d = deps({
      fetchUsername: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
    });

    await reconcileDiscordConnection(d);

    expect(d.linkIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ displayIdentity: `Discord ID: ${DISCORD_USER}` }),
    );
  });

  it("reuses the stored display identity in steady state without re-linking or re-fetching", async () => {
    const d = deps({
      getIdentity: vi
        .fn<(id: string) => Promise<MappedDiscordIdentity | null>>()
        .mockResolvedValue({ ownerUserId: OWNER, displayIdentity: "nickneely" }),
    });

    await reconcileDiscordConnection(d);

    expect(d.linkIdentity).not.toHaveBeenCalled();
    expect(d.fetchUsername).not.toHaveBeenCalled();
    expect(d.connect).toHaveBeenCalledWith(
      expect.objectContaining({ displayIdentity: "nickneely" }),
    );
  });

  it("refuses to reassign a Discord user mapped to a different owner (pre-check)", async () => {
    const d = deps({
      getIdentity: vi
        .fn<(id: string) => Promise<MappedDiscordIdentity | null>>()
        .mockResolvedValue({ ownerUserId: "owner-2", displayIdentity: "someoneelse" }),
    });

    await reconcileDiscordConnection(d);

    expect(d.linkIdentity).not.toHaveBeenCalled();
    expect(d.connect).not.toHaveBeenCalled();
    expect(d.recordError).toHaveBeenCalledWith({
      ownerUserId: OWNER,
      providerKey: "discord",
      capabilityKey: "channel",
      message: DISCORD_IDENTITY_CONFLICT_MESSAGE,
    });
  });

  it("surfaces the conflict when another owner claims the mapping between pre-check and write (TOCTOU)", async () => {
    // Pre-check sees no mapping, so we attempt to link; the persisted reassign guard
    // then throws because another owner won the race. The recheck confirms the
    // conflict and records it instead of letting the throw escape to be swallowed.
    const getIdentity = vi
      .fn<(id: string) => Promise<MappedDiscordIdentity | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ownerUserId: "owner-2", displayIdentity: "someoneelse" });
    const d = deps({
      getIdentity,
      linkIdentity: vi.fn().mockRejectedValue(new Error("already mapped to a different owner")),
    });

    await reconcileDiscordConnection(d);

    expect(d.connect).not.toHaveBeenCalled();
    expect(d.recordError).toHaveBeenCalledWith(
      expect.objectContaining({ message: DISCORD_IDENTITY_CONFLICT_MESSAGE }),
    );
  });

  it("rethrows an unrelated link failure instead of masking it as a conflict", async () => {
    // linkIdentity fails for a non-ownership reason; the recheck still shows no
    // rival owner, so the error propagates to the caller's best-effort catch.
    const getIdentity = vi
      .fn<(id: string) => Promise<MappedDiscordIdentity | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const d = deps({
      getIdentity,
      linkIdentity: vi.fn().mockRejectedValue(new Error("db unavailable")),
    });

    await expect(reconcileDiscordConnection(d)).rejects.toThrow("db unavailable");
    expect(d.recordError).not.toHaveBeenCalled();
    expect(d.connect).not.toHaveBeenCalled();
  });

  it("is a no-op when no Discord account is linked", async () => {
    const d = deps({ accounts: [] });

    await reconcileDiscordConnection(d);

    expect(d.getIdentity).not.toHaveBeenCalled();
    expect(d.linkIdentity).not.toHaveBeenCalled();
    expect(d.connect).not.toHaveBeenCalled();
  });
});
