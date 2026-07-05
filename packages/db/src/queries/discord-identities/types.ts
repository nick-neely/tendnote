/**
 * Persisted owner-scoped Discord identity record. Non-secret: it maps a Discord
 * user id to the Tendnote owner that Discord interactions capture for. See
 * `schema/app/discord-identities.ts` for the canonical description.
 */
export type DiscordIdentity = {
  id: string;
  ownerUserId: string;
  discordUserId: string;
  displayIdentity: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Full mapping the store upserts, keyed on the unique `discordUserId`. */
export type PersistDiscordIdentityInput = {
  ownerUserId: string;
  discordUserId: string;
  displayIdentity: string | null;
};

/**
 * Create/update a Discord identity mapping. Owner ids never come from Discord
 * input. Reassigning a Discord user id already mapped to a different owner
 * requires explicit `reassign: true` intent.
 */
export type LinkDiscordIdentityInput = Omit<PersistDiscordIdentityInput, "displayIdentity"> & {
  displayIdentity?: string | null;
  reassign?: boolean;
};

/** Identifies one owner-scoped Discord identity row for mutation. */
export type DiscordIdentityRef = {
  ownerUserId: string;
  discordUserId: string;
};

export type DiscordIdentityStore = {
  getByDiscordUserId: (discordUserId: string) => Promise<DiscordIdentity | null>;
  listByOwner: (ownerUserId: string) => Promise<DiscordIdentity[]>;
  upsertByDiscordUserId: (values: PersistDiscordIdentityInput) => Promise<DiscordIdentity>;
  deleteOwned: (ref: DiscordIdentityRef) => Promise<boolean>;
};
