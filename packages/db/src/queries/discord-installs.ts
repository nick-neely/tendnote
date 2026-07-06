import { createDrizzleDiscordInstallStore } from "./discord-installs/drizzle-store";
import { createDiscordInstallQueries } from "./discord-installs/queries";
import type {
  ConfigureDiscordTargetInput,
  DiscordInstallRef,
  RecordDiscordInstallInput,
} from "./discord-installs/types";

export { createDrizzleDiscordInstallStore } from "./discord-installs/drizzle-store";
export { createInMemoryDiscordInstallStore } from "./discord-installs/in-memory-store";
export { createDiscordInstallQueries } from "./discord-installs/queries";
export type * from "./discord-installs/types";

const defaultDiscordInstallQueries = createDiscordInstallQueries(
  createDrizzleDiscordInstallStore(),
);

export async function recordDiscordInstall(input: RecordDiscordInstallInput) {
  return defaultDiscordInstallQueries.recordDiscordInstall(input);
}

export async function configureDiscordTarget(input: ConfigureDiscordTargetInput) {
  return defaultDiscordInstallQueries.configureDiscordTarget(input);
}

export async function setDiscordDeliveryEnabled(input: DiscordInstallRef & { enabled: boolean }) {
  return defaultDiscordInstallQueries.setDiscordDeliveryEnabled(input);
}

export async function getDiscordInstall(ref: DiscordInstallRef) {
  return defaultDiscordInstallQueries.getDiscordInstall(ref);
}

export async function listDiscordInstalls(input: { ownerUserId: string }) {
  return defaultDiscordInstallQueries.listDiscordInstalls(input);
}

export async function listDiscordInstallsForGuild(input: { guildId: string }) {
  return defaultDiscordInstallQueries.listInstallsForGuild(input);
}

/**
 * Derive the enabled, configured proactive-delivery destination for an owner, or
 * `null` when none is deliverable. Owner-scoped read seam for populating the
 * workflow-specific delivery setting.
 */
export async function deriveDiscordDeliveryTarget(input: {
  ownerUserId: string;
  guildId?: string;
}) {
  return defaultDiscordInstallQueries.deriveDeliveryTarget(input);
}

export async function removeDiscordInstall(ref: DiscordInstallRef) {
  return defaultDiscordInstallQueries.removeDiscordInstall(ref);
}
