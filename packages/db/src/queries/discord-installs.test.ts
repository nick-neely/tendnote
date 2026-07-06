import { describe, expect, it } from "vitest";
import { createInMemoryDiscordIdentityStore } from "./discord-identities/in-memory-store";
import { createDiscordIdentityQueries } from "./discord-identities/queries";
import { createInMemoryDiscordInstallStore } from "./discord-installs/in-memory-store";
import { createDiscordInstallQueries } from "./discord-installs/queries";
import type { DiscordInstall } from "./discord-installs/types";

function installFixture(
  input: Partial<DiscordInstall> & { ownerUserId: string; guildId: string; discordUserId: string },
): DiscordInstall {
  const now = new Date("2026-07-05T12:00:00.000Z");

  return {
    id: input.id ?? `di-${input.ownerUserId}-${input.guildId}`,
    ownerUserId: input.ownerUserId,
    guildId: input.guildId,
    discordUserId: input.discordUserId,
    targetKind: input.targetKind ?? null,
    targetChannelId: input.targetChannelId ?? null,
    enabled: input.enabled ?? true,
    scopes: input.scopes ?? null,
    permissions: input.permissions ?? null,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

describe("Discord install and target persistence", () => {
  it("records install metadata without a token, signature, or raw payload", async () => {
    const store = createInMemoryDiscordInstallStore();
    const queries = createDiscordInstallQueries(store);

    const install = await queries.recordDiscordInstall({
      ownerUserId: "owner-1",
      guildId: "guild-1",
      discordUserId: "discord-1",
      scopes: ["bot", "applications.commands"],
      permissions: "2048",
    });

    expect(install).toMatchObject({
      ownerUserId: "owner-1",
      guildId: "guild-1",
      discordUserId: "discord-1",
      scopes: ["bot", "applications.commands"],
      permissions: "2048",
      enabled: true,
      targetKind: null,
      targetChannelId: null,
    });
    // The persisted shape carries only non-secret install metadata.
    expect(Object.keys(install).sort()).toEqual(
      [
        "createdAt",
        "discordUserId",
        "enabled",
        "guildId",
        "id",
        "ownerUserId",
        "permissions",
        "scopes",
        "targetChannelId",
        "targetKind",
        "updatedAt",
      ].sort(),
    );
  });

  it("keeps two owners in one guild independent when they configure different targets", async () => {
    const store = createInMemoryDiscordInstallStore();
    const queries = createDiscordInstallQueries(store);

    // Two Tendnote owners share one Discord guild.
    await queries.recordDiscordInstall({
      ownerUserId: "owner-1",
      guildId: "shared-guild",
      discordUserId: "discord-1",
    });
    await queries.recordDiscordInstall({
      ownerUserId: "owner-2",
      guildId: "shared-guild",
      discordUserId: "discord-2",
    });

    await queries.configureDiscordTarget({
      ownerUserId: "owner-1",
      guildId: "shared-guild",
      targetKind: "channel",
      targetChannelId: "channel-1",
    });
    await queries.configureDiscordTarget({
      ownerUserId: "owner-2",
      guildId: "shared-guild",
      targetKind: "channel",
      targetChannelId: "channel-2",
    });

    // Each owner derives only their own target; neither leaks into the other.
    await expect(
      queries.deriveDeliveryTarget({ ownerUserId: "owner-1", guildId: "shared-guild" }),
    ).resolves.toEqual({ guildId: "shared-guild", targetKind: "channel", targetId: "channel-1" });
    await expect(
      queries.deriveDeliveryTarget({ ownerUserId: "owner-2", guildId: "shared-guild" }),
    ).resolves.toEqual({ guildId: "shared-guild", targetKind: "channel", targetId: "channel-2" });

    const guildInstalls = await queries.listInstallsForGuild({ guildId: "shared-guild" });
    expect(guildInstalls).toHaveLength(2);
    expect(guildInstalls.map((install) => install.targetChannelId)).toEqual([
      "channel-1",
      "channel-2",
    ]);
  });

  it("cannot configure or read another owner's install in the same guild", async () => {
    const store = createInMemoryDiscordInstallStore({
      discordInstalls: [
        installFixture({
          ownerUserId: "owner-1",
          guildId: "shared-guild",
          discordUserId: "discord-1",
          targetKind: "channel",
          targetChannelId: "channel-1",
        }),
      ],
    });
    const queries = createDiscordInstallQueries(store);

    // A different owner has no install here, so configuring is a no-op, not a hijack.
    await expect(
      queries.configureDiscordTarget({
        ownerUserId: "owner-2",
        guildId: "shared-guild",
        targetKind: "channel",
        targetChannelId: "channel-hijack",
      }),
    ).resolves.toBeNull();
    await expect(
      queries.getDiscordInstall({ ownerUserId: "owner-2", guildId: "shared-guild" }),
    ).resolves.toBeNull();

    // owner-1's target is untouched.
    await expect(
      queries.deriveDeliveryTarget({ ownerUserId: "owner-1", guildId: "shared-guild" }),
    ).resolves.toEqual({ guildId: "shared-guild", targetKind: "channel", targetId: "channel-1" });
  });

  it("disables and re-enables delivery without deleting the install or identity link", async () => {
    const store = createInMemoryDiscordInstallStore({
      discordInstalls: [
        installFixture({
          ownerUserId: "owner-1",
          guildId: "guild-1",
          discordUserId: "discord-1",
          targetKind: "channel",
          targetChannelId: "channel-1",
        }),
      ],
    });
    const queries = createDiscordInstallQueries(store);

    // The owner also has a persisted Discord identity link (a separate table);
    // toggling delivery must never disturb it.
    const identityQueries = createDiscordIdentityQueries(createInMemoryDiscordIdentityStore());
    await identityQueries.linkDiscordIdentity({
      ownerUserId: "owner-1",
      discordUserId: "discord-1",
    });

    const disabled = await queries.setDiscordDeliveryEnabled({
      ownerUserId: "owner-1",
      guildId: "guild-1",
      enabled: false,
    });
    expect(disabled?.enabled).toBe(false);

    // Disabled derives to no deliverable target, but the install (and its target) remains.
    await expect(
      queries.deriveDeliveryTarget({ ownerUserId: "owner-1", guildId: "guild-1" }),
    ).resolves.toBeNull();
    await expect(
      queries.getDiscordInstall({ ownerUserId: "owner-1", guildId: "guild-1" }),
    ).resolves.toMatchObject({ enabled: false, targetChannelId: "channel-1" });
    // The identity link is untouched while delivery is disabled.
    await expect(identityQueries.resolveOwnerUserId({ discordUserId: "discord-1" })).resolves.toBe(
      "owner-1",
    );

    const reEnabled = await queries.setDiscordDeliveryEnabled({
      ownerUserId: "owner-1",
      guildId: "guild-1",
      enabled: true,
    });
    expect(reEnabled?.enabled).toBe(true);

    // Re-enabling restores the same target without reconfiguring it.
    await expect(
      queries.deriveDeliveryTarget({ ownerUserId: "owner-1", guildId: "guild-1" }),
    ).resolves.toEqual({ guildId: "guild-1", targetKind: "channel", targetId: "channel-1" });
    // The identity link still resolves after the full disable/re-enable cycle.
    await expect(identityQueries.resolveOwnerUserId({ discordUserId: "discord-1" })).resolves.toBe(
      "owner-1",
    );
  });

  it("preserves target and enabled state when an install is re-recorded", async () => {
    const store = createInMemoryDiscordInstallStore();
    const queries = createDiscordInstallQueries(store);

    await queries.recordDiscordInstall({
      ownerUserId: "owner-1",
      guildId: "guild-1",
      discordUserId: "discord-1",
      scopes: ["bot"],
    });
    await queries.configureDiscordTarget({
      ownerUserId: "owner-1",
      guildId: "guild-1",
      targetKind: "channel",
      targetChannelId: "channel-1",
    });
    await queries.setDiscordDeliveryEnabled({
      ownerUserId: "owner-1",
      guildId: "guild-1",
      enabled: false,
    });

    // Re-recording refreshes install metadata but must not clobber target/enabled.
    const refreshed = await queries.recordDiscordInstall({
      ownerUserId: "owner-1",
      guildId: "guild-1",
      discordUserId: "discord-1-renamed",
      scopes: ["bot", "applications.commands"],
    });

    expect(refreshed).toMatchObject({
      discordUserId: "discord-1-renamed",
      scopes: ["bot", "applications.commands"],
      targetKind: "channel",
      targetChannelId: "channel-1",
      enabled: false,
    });

    // Re-recording without scope/permission fields preserves the stored metadata
    // rather than silently wiping it.
    const preserved = await queries.recordDiscordInstall({
      ownerUserId: "owner-1",
      guildId: "guild-1",
      discordUserId: "discord-1-renamed",
    });

    expect(preserved).toMatchObject({
      scopes: ["bot", "applications.commands"],
      targetKind: "channel",
      targetChannelId: "channel-1",
      enabled: false,
    });
  });

  it("derives an owner's single target and fails closed on ambiguity without a guild", async () => {
    const store = createInMemoryDiscordInstallStore({
      discordInstalls: [
        installFixture({
          ownerUserId: "owner-1",
          guildId: "guild-a",
          discordUserId: "discord-1",
          targetKind: "channel",
          targetChannelId: "channel-a",
        }),
      ],
    });
    const queries = createDiscordInstallQueries(store);

    // A single deliverable install resolves without needing a guild id.
    await expect(queries.deriveDeliveryTarget({ ownerUserId: "owner-1" })).resolves.toEqual({
      guildId: "guild-a",
      targetKind: "channel",
      targetId: "channel-a",
    });

    // A second deliverable install makes the guild-less derivation ambiguous.
    await queries.recordDiscordInstall({
      ownerUserId: "owner-1",
      guildId: "guild-b",
      discordUserId: "discord-1",
    });
    await queries.configureDiscordTarget({
      ownerUserId: "owner-1",
      guildId: "guild-b",
      targetKind: "dm",
      targetChannelId: "dm-b",
    });

    await expect(queries.deriveDeliveryTarget({ ownerUserId: "owner-1" })).resolves.toBeNull();
    // Disambiguating by guild still works.
    await expect(
      queries.deriveDeliveryTarget({ ownerUserId: "owner-1", guildId: "guild-b" }),
    ).resolves.toEqual({ guildId: "guild-b", targetKind: "dm", targetId: "dm-b" });
  });

  it("removes only the requesting owner's install", async () => {
    const store = createInMemoryDiscordInstallStore({
      discordInstalls: [
        installFixture({
          ownerUserId: "owner-1",
          guildId: "shared-guild",
          discordUserId: "discord-1",
        }),
        installFixture({
          ownerUserId: "owner-2",
          guildId: "shared-guild",
          discordUserId: "discord-2",
        }),
      ],
    });
    const queries = createDiscordInstallQueries(store);

    await expect(
      queries.removeDiscordInstall({ ownerUserId: "owner-1", guildId: "shared-guild" }),
    ).resolves.toBe(true);
    await expect(
      queries.getDiscordInstall({ ownerUserId: "owner-1", guildId: "shared-guild" }),
    ).resolves.toBeNull();
    // owner-2's install in the same guild is untouched.
    await expect(
      queries.getDiscordInstall({ ownerUserId: "owner-2", guildId: "shared-guild" }),
    ).resolves.not.toBeNull();
    // Removing a non-existent (or foreign) install returns false.
    await expect(
      queries.removeDiscordInstall({ ownerUserId: "owner-1", guildId: "shared-guild" }),
    ).resolves.toBe(false);
  });
});
