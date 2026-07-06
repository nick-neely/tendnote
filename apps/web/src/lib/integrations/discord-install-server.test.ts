import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listDiscordIdentities,
  recordDiscordInstall,
  configureDiscordTarget,
  listDiscordInstalls,
  setDiscordDeliveryEnabled,
  requireAdmittedOwner,
  requireAdmittedOwnerForAction,
} = vi.hoisted(() => ({
  listDiscordIdentities: vi.fn(),
  recordDiscordInstall: vi.fn(),
  configureDiscordTarget: vi.fn(),
  listDiscordInstalls: vi.fn(),
  setDiscordDeliveryEnabled: vi.fn(),
  requireAdmittedOwner: vi.fn(),
  requireAdmittedOwnerForAction: vi.fn(),
}));

// `server-only` throws outside an RSC bundle; stub it so the module loads in tests.
vi.mock("server-only", () => ({}));
vi.mock("@tendnote/db/queries/discord-identities", () => ({ listDiscordIdentities }));
vi.mock("@tendnote/db/queries/discord-installs", () => ({
  recordDiscordInstall,
  configureDiscordTarget,
  listDiscordInstalls,
  setDiscordDeliveryEnabled,
}));
vi.mock("@/lib/access/current-access", () => ({
  requireAdmittedOwner,
  requireAdmittedOwnerForAction,
}));

const { configureOwnerDiscordTarget, recordOwnerDiscordInstall } = await import(
  "./discord-install-server"
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordOwnerDiscordInstall", () => {
  it("fails closed when the owner has no linked Discord identity", async () => {
    // The install can only be attributed via the owner's linked identity; with none
    // linked, nothing is recorded (no Discord user id inferred from the guild).
    listDiscordIdentities.mockResolvedValue([]);

    await expect(
      recordOwnerDiscordInstall({
        ownerUserId: "owner-1",
        guildId: "guild-1",
        permissions: "19456",
        scopes: ["bot", "applications.commands"],
      }),
    ).resolves.toEqual({ status: "missing_identity" });
    expect(recordDiscordInstall).not.toHaveBeenCalled();
  });

  it("records the install with the linked Discord user id when identity exists", async () => {
    listDiscordIdentities.mockResolvedValue([
      { ownerUserId: "owner-1", discordUserId: "discord-1" },
    ]);
    recordDiscordInstall.mockResolvedValue({ id: "install-1" });

    await expect(
      recordOwnerDiscordInstall({
        ownerUserId: "owner-1",
        guildId: "guild-1",
        permissions: "19456",
        scopes: ["bot", "applications.commands"],
      }),
    ).resolves.toEqual({ status: "recorded" });
    expect(recordDiscordInstall).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      guildId: "guild-1",
      discordUserId: "discord-1",
      scopes: ["bot", "applications.commands"],
      permissions: "19456",
    });
  });
});

describe("configureOwnerDiscordTarget", () => {
  beforeEach(() => {
    requireAdmittedOwnerForAction.mockResolvedValue("owner-1");
  });

  it("rejects a whitespace-only channel id server-side without persisting", async () => {
    await expect(
      configureOwnerDiscordTarget({ guildId: "guild-1", targetChannelId: "   " }),
    ).rejects.toThrow();
    expect(configureDiscordTarget).not.toHaveBeenCalled();
  });

  it("rejects a malformed (non-snowflake) channel id server-side", async () => {
    await expect(
      configureOwnerDiscordTarget({ guildId: "guild-1", targetChannelId: "not-a-channel" }),
    ).rejects.toThrow();
    expect(configureDiscordTarget).not.toHaveBeenCalled();
  });

  it("persists a valid, trimmed channel id scoped to the admitted owner", async () => {
    configureDiscordTarget.mockResolvedValue({ id: "install-1" });

    await configureOwnerDiscordTarget({
      guildId: "guild-1",
      targetChannelId: "  123456789012345678  ",
    });

    expect(configureDiscordTarget).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      guildId: "guild-1",
      targetKind: "channel",
      targetChannelId: "123456789012345678",
    });
  });
});
