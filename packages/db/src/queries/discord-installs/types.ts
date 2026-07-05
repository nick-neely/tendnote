export type DiscordTargetKind = "channel" | "dm";

/**
 * Persisted owner-scoped Discord install and proactive-delivery target record.
 * Non-secret: it records that a Tendnote owner installed the shared Discord
 * application into one guild and, optionally, where that owner's proactive
 * deliveries land. See `schema/app/discord-installs.ts` for the canonical
 * description and the (owner, guild) uniqueness rationale.
 */
export type DiscordInstall = {
  id: string;
  ownerUserId: string;
  guildId: string;
  discordUserId: string;
  targetKind: DiscordTargetKind | null;
  targetChannelId: string | null;
  enabled: boolean;
  scopes: string[] | null;
  permissions: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Identifies one owner-scoped install row for lookup or mutation. */
export type DiscordInstallRef = {
  ownerUserId: string;
  guildId: string;
};

/**
 * Record (create or refresh) an owner's install of the shared Discord app into a
 * guild. Owner ids never come from Discord input. Re-recording preserves any
 * already-configured target and enabled state — installing is not the same
 * action as (re)configuring where deliveries land.
 */
export type RecordDiscordInstallInput = {
  ownerUserId: string;
  guildId: string;
  discordUserId: string;
  scopes?: string[] | null;
  permissions?: string | null;
};

/** Configure where an owner's proactive deliveries land in a guild. */
export type ConfigureDiscordTargetInput = DiscordInstallRef & {
  targetKind: DiscordTargetKind;
  targetChannelId: string;
};

/**
 * Full mapping the store upserts, keyed on the unique (owner, guild) pair. On a
 * re-record, `scopes`/`permissions` left `undefined` preserve the stored values;
 * only an explicit value (including `null`) overwrites them.
 */
export type PersistDiscordInstallInput = {
  ownerUserId: string;
  guildId: string;
  discordUserId: string;
  scopes?: string[] | null;
  permissions?: string | null;
};

/** Partial patch the store applies to an existing owner-scoped install. */
export type DiscordInstallPatch = {
  targetKind?: DiscordTargetKind;
  targetChannelId?: string;
  enabled?: boolean;
};

/**
 * A derived proactive-delivery destination for an owner: the enabled install
 * with a configured target. This is what higher layers use to populate the
 * owner-scoped, workflow-specific delivery setting; a disabled or unconfigured
 * install derives to `null` and is not deliverable.
 */
export type DiscordDeliveryTarget = {
  guildId: string;
  targetKind: DiscordTargetKind;
  targetId: string;
};

export type DiscordInstallStore = {
  getByOwnerGuild: (ref: DiscordInstallRef) => Promise<DiscordInstall | null>;
  listByOwner: (ownerUserId: string) => Promise<DiscordInstall[]>;
  listByGuild: (guildId: string) => Promise<DiscordInstall[]>;
  upsertByOwnerGuild: (values: PersistDiscordInstallInput) => Promise<DiscordInstall>;
  patchOwned: (
    ref: DiscordInstallRef,
    patch: DiscordInstallPatch,
  ) => Promise<DiscordInstall | null>;
  deleteOwned: (ref: DiscordInstallRef) => Promise<boolean>;
};
