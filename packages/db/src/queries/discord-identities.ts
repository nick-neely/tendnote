import { createDrizzleDiscordIdentityStore } from "./discord-identities/drizzle-store";
import { createDiscordIdentityQueries } from "./discord-identities/queries";
import type { DiscordIdentityRef, LinkDiscordIdentityInput } from "./discord-identities/types";

export { createDrizzleDiscordIdentityStore } from "./discord-identities/drizzle-store";
export { createInMemoryDiscordIdentityStore } from "./discord-identities/in-memory-store";
export { createDiscordIdentityQueries } from "./discord-identities/queries";
export type * from "./discord-identities/types";

const defaultDiscordIdentityQueries = createDiscordIdentityQueries(
  createDrizzleDiscordIdentityStore(),
);

/** Resolve the Tendnote owner for a Discord user id, or `null` when unmapped. */
export async function resolveDiscordIdentityOwner(input: { discordUserId: string }) {
  return defaultDiscordIdentityQueries.resolveOwnerUserId(input);
}

export async function getDiscordIdentity(input: { discordUserId: string }) {
  return defaultDiscordIdentityQueries.getDiscordIdentity(input);
}

export async function listDiscordIdentities(input: { ownerUserId: string }) {
  return defaultDiscordIdentityQueries.listDiscordIdentities(input);
}

export async function linkDiscordIdentity(input: LinkDiscordIdentityInput) {
  return defaultDiscordIdentityQueries.linkDiscordIdentity(input);
}

export async function unlinkDiscordIdentity(ref: DiscordIdentityRef) {
  return defaultDiscordIdentityQueries.unlinkDiscordIdentity(ref);
}
