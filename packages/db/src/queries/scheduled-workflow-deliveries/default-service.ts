import { deriveDiscordDeliveryTarget } from "../discord-installs";
import { createDrizzleScheduledWorkflowDeliveryStore } from "./drizzle-store";
import {
  createScheduledWorkflowDeliveryService,
  type DiscordInstallConsentResolver,
} from "./service";

/**
 * Send-time consent resolver backed by the real owner-scoped Discord install seam
 * (finding C). `deriveDiscordDeliveryTarget` returns the owner's currently enabled +
 * configured install channel, or `null` when the install is paused, unconfigured,
 * or ambiguous (more than one deliverable install) — so pausing or removing the
 * channel fails closed here and a channel change is honored on the next send.
 */
const resolveDiscordInstallConsent: DiscordInstallConsentResolver = async ({ ownerUserId }) => {
  const target = await deriveDiscordDeliveryTarget({ ownerUserId });
  return target ? { targetChannelId: target.targetId } : null;
};

/**
 * The production scheduled-workflow delivery service: the drizzle-backed store plus
 * the authoritative install-consent recheck. All Phase 3/5 workflow dispatchers
 * share this single construction so the send-time consent binding lives in exactly
 * one place rather than being re-derived (and possibly forgotten) per workflow.
 */
export function createDefaultScheduledWorkflowDeliveryService() {
  return createScheduledWorkflowDeliveryService(createDrizzleScheduledWorkflowDeliveryStore(), {
    resolveInstallConsent: resolveDiscordInstallConsent,
  });
}
