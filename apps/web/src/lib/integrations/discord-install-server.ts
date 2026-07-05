import "server-only";

import { listDiscordIdentities } from "@tendnote/db/queries/discord-identities";
import {
  configureDiscordTarget,
  type DiscordInstall,
  listDiscordInstalls,
  recordDiscordInstall,
  setDiscordDeliveryEnabled,
} from "@tendnote/db/queries/discord-installs";
import { requireAdmittedOwner, requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { isDiscordChannelId } from "./discord-install";

/**
 * Hosted product boundary for the Discord bot install and its owner-scoped
 * delivery-target configuration (issue #173, ADR-0139). Every entry point resolves
 * the admitted owner first and scopes the underlying `discord_installs` seam to
 * that owner, so one Tendnote user can never read or configure another user's
 * install — even in a shared guild. Reads use the page gate (redirects pending /
 * unauthenticated callers); mutations use the action gate (throws, failing closed).
 */

export type OwnerDiscordInstallsView = {
  ownerUserId: string;
  /** The owner's linked Discord user id (ADR-0138), or null when not connected. */
  discordUserId: string | null;
  installs: DiscordInstall[];
};

/**
 * Read the admitted owner's installs plus whether their Discord identity is linked.
 * The install flow needs a linked identity to attribute a Discord user id, so the
 * UI gates the "Install to a server" affordance on `discordUserId` being present.
 */
export async function getOwnerDiscordInstalls(): Promise<OwnerDiscordInstallsView> {
  const ownerUserId = await requireAdmittedOwner();
  const [identities, installs] = await Promise.all([
    listDiscordIdentities({ ownerUserId }),
    listDiscordInstalls({ ownerUserId }),
  ]);
  return {
    ownerUserId,
    discordUserId: identities[0]?.discordUserId ?? null,
    installs,
  };
}

/**
 * Record (or refresh) the just-validated bot install for an owner resolved from
 * the signed-in session by the install callback. The Discord user id is taken from
 * the owner's linked identity (ADR-0138), never from the guild; a missing identity
 * fails closed so no install is attributed to an unlinked owner. Re-recording
 * preserves any configured target and enabled flag (seam semantics, #168).
 */
export async function recordOwnerDiscordInstall(input: {
  ownerUserId: string;
  guildId: string;
  permissions: string | null;
  scopes: string[];
}): Promise<{ status: "recorded" } | { status: "missing_identity" }> {
  const identities = await listDiscordIdentities({ ownerUserId: input.ownerUserId });
  const discordUserId = identities[0]?.discordUserId;
  if (!discordUserId) {
    return { status: "missing_identity" };
  }

  await recordDiscordInstall({
    ownerUserId: input.ownerUserId,
    guildId: input.guildId,
    discordUserId,
    scopes: input.scopes,
    permissions: input.permissions,
  });
  return { status: "recorded" };
}

/**
 * Configure where the admitted owner's proactive deliveries land in a guild.
 * Rejects a malformed or whitespace-only channel id server-side (never trusting
 * client validation), so a direct action call can't persist an empty target.
 */
export async function configureOwnerDiscordTarget(input: {
  guildId: string;
  targetChannelId: string;
}): Promise<DiscordInstall | null> {
  const targetChannelId = input.targetChannelId.trim();
  if (!isDiscordChannelId(targetChannelId)) {
    throw new Error("A Discord channel id must be 17–20 digits.");
  }
  const ownerUserId = await requireAdmittedOwnerForAction();
  return configureDiscordTarget({
    ownerUserId,
    guildId: input.guildId,
    targetKind: "channel",
    targetChannelId,
  });
}

/** Enable or pause proactive delivery for the admitted owner's install in a guild. */
export async function setOwnerDiscordDeliveryEnabled(input: {
  guildId: string;
  enabled: boolean;
}): Promise<DiscordInstall | null> {
  const ownerUserId = await requireAdmittedOwnerForAction();
  return setDiscordDeliveryEnabled({
    ownerUserId,
    guildId: input.guildId,
    enabled: input.enabled,
  });
}
