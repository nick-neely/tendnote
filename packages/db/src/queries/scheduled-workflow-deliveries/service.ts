import type {
  ScheduledWorkflowDeliveryArtifact,
  ScheduledWorkflowDeliveryAttempt,
  ScheduledWorkflowDeliverySetting,
  UpsertScheduledWorkflowDeliverySettingInput,
} from "@tendnote/domain";
import type { ScheduledWorkflowDeliveryStore } from "./types";

export type DiscordProactiveDeliverySender = (input: {
  targetId: string;
  content: string;
}) => Promise<void>;

type DeliverDiscordScheduledArtifactInput = {
  artifact: ScheduledWorkflowDeliveryArtifact;
  sender: DiscordProactiveDeliverySender;
};

export type DiscordScheduledArtifactDeliveryResult =
  | { type: "sent"; attempt: ScheduledWorkflowDeliveryAttempt }
  | { type: "skipped"; reason: string; attempt: ScheduledWorkflowDeliveryAttempt }
  | { type: "failed"; error: string; attempt: ScheduledWorkflowDeliveryAttempt };

export function createScheduledWorkflowDeliveryService(store: ScheduledWorkflowDeliveryStore) {
  return {
    configureDiscordWorkflowDelivery(
      input: Omit<UpsertScheduledWorkflowDeliverySettingInput, "channel">,
    ) {
      return store.upsertScheduledWorkflowDeliverySetting({ ...input, channel: "discord" });
    },

    listWorkflowDeliverySettingsForOwner(input: { ownerUserId: string }) {
      return store.listScheduledWorkflowDeliverySettingsForOwner(input);
    },

    listDeliveryAttemptsForArtifact(input: { ownerUserId: string; artifactId: string }) {
      return store.listScheduledWorkflowDeliveryAttemptsForArtifact(input);
    },

    listDeliveryAttemptsForOwner(input: {
      ownerUserId: string;
      status?: "sent" | "skipped" | "failed";
    }) {
      return store.listScheduledWorkflowDeliveryAttemptsForOwner(input);
    },

    async deliverDiscordScheduledArtifact(
      input: DeliverDiscordScheduledArtifactInput,
    ): Promise<DiscordScheduledArtifactDeliveryResult> {
      if (input.artifact.persisted !== true) {
        throw new Error("Scheduled artifacts must be persisted before Discord delivery.");
      }

      const setting = await store.getScheduledWorkflowDeliverySetting({
        ownerUserId: input.artifact.ownerUserId,
        workflow: input.artifact.workflow,
        channel: "discord",
      });

      const skippedReason = discordDeliverySkipReason(setting, input.artifact);
      if (skippedReason) {
        const attempt = await store.createScheduledWorkflowDeliveryAttempt({
          ownerUserId: input.artifact.ownerUserId,
          workflow: input.artifact.workflow,
          channel: "discord",
          artifactKind: input.artifact.artifactKind,
          artifactId: input.artifact.artifactId,
          targetId: setting?.targetId ?? null,
          status: "skipped",
          reason: skippedReason,
          error: null,
        });

        return { type: "skipped", reason: skippedReason, attempt };
      }

      if (!setting) {
        throw new Error("Discord delivery setting unexpectedly missing after policy check.");
      }

      try {
        await input.sender({
          targetId: setting.targetId,
          content: renderDiscordArtifactNudge(input.artifact),
        });
      } catch (error) {
        const message = scrubDeliveryError(error instanceof Error ? error.message : String(error));
        const attempt = await store.createScheduledWorkflowDeliveryAttempt({
          ownerUserId: input.artifact.ownerUserId,
          workflow: input.artifact.workflow,
          channel: "discord",
          artifactKind: input.artifact.artifactKind,
          artifactId: input.artifact.artifactId,
          targetId: setting.targetId,
          status: "failed",
          reason: "discord_send_failed",
          error: message,
        });

        return { type: "failed", error: message, attempt };
      }

      const attempt = await store.createScheduledWorkflowDeliveryAttempt({
        ownerUserId: input.artifact.ownerUserId,
        workflow: input.artifact.workflow,
        channel: "discord",
        artifactKind: input.artifact.artifactKind,
        artifactId: input.artifact.artifactId,
        targetId: setting.targetId,
        status: "sent",
        reason: null,
        error: null,
      });

      return { type: "sent", attempt };
    },
  };
}

/**
 * Fail-closed Phase 4 delivery policy: decide whether a persisted scheduled
 * artifact may be proactively posted to its owner's configured Discord target,
 * returning a skip reason when it may not. Every check gates disclosure before
 * anything reaches Discord; the nudge itself is summary-only (see
 * `renderDiscordArtifactNudge`), so an allowed private-summary path never leaks
 * artifact detail. Owner, sensitivity, and target scope are all evaluated, and
 * an unknown artifact scope is treated as `private`.
 */
function discordDeliverySkipReason(
  setting: ScheduledWorkflowDeliverySetting | null,
  artifact: ScheduledWorkflowDeliveryArtifact,
): string | null {
  if (!setting) {
    return "missing_discord_target";
  }

  if (!setting.enabled) {
    return "discord_delivery_disabled";
  }

  // Owner boundary: a target only ever delivers its own owner's artifacts.
  if (setting.ownerUserId !== artifact.ownerUserId) {
    return "owner_mismatch";
  }

  if (artifact.sensitivity === "restricted") {
    return "restricted_content_filtered";
  }

  if (artifact.sensitivity === "sensitive" && !setting.allowSensitive) {
    return "sensitive_content_filtered";
  }

  return discordScopeSkipReason(setting, artifact);
}

/**
 * The target-scope half of the #170 policy matrix, applied once owner and
 * sensitivity gates have already passed. Decides whether the artifact's scope may
 * reach the setting's configured target scope; an unknown artifact scope is
 * treated as `private`. Pure and total over the scope combinations.
 */
function discordScopeSkipReason(
  setting: ScheduledWorkflowDeliverySetting,
  artifact: ScheduledWorkflowDeliveryArtifact,
): string | null {
  // A private target is owner-only, so it is safe for the owner's artifacts of
  // any scope. Sharing gates only apply to shared/household destinations.
  if (setting.targetScope === "private") {
    return null;
  }

  const artifactScope = artifact.scope ?? "private";

  if (artifactScope === "household") {
    return householdScopeSkipReason(setting, artifact);
  }

  // A private artifact on a shared/household destination over-discloses. Only its
  // safe summary may go through, and only when the owner has explicitly opted in.
  // The private-summary allowance consents to broadcasting a private summary to a
  // broader audience — it does NOT also consent to disclosing sensitive material
  // there, so a `sensitive` artifact never rides this path even when both
  // `allowSensitive` and `allowPrivateSummary` are set (it can only have reached
  // here on a target that allows sensitive content). Sensitivity and the
  // private-summary allowance never compound to a shared send.
  if (artifactScope === "private") {
    const allowed = setting.allowPrivateSummary && artifact.sensitivity === "normal";
    return allowed ? null : "private_content_filtered";
  }

  // A `shared` (selected-members) artifact has no honest home on a Discord
  // channel: a shared/household channel can't honor selected-member granularity,
  // so it is never deliverable there. Reported distinctly so the skip record
  // reflects what actually happened.
  return "shared_content_filtered";
}

/**
 * Household content is only deliverable to a target explicitly configured as
 * household-safe for the artifact's exact household; anything else over-discloses.
 */
function householdScopeSkipReason(
  setting: ScheduledWorkflowDeliverySetting,
  artifact: ScheduledWorkflowDeliveryArtifact,
): string | null {
  if (setting.targetScope !== "household") {
    return "household_target_required";
  }
  if (!setting.targetHouseholdId || setting.targetHouseholdId !== artifact.householdId) {
    return "household_target_mismatch";
  }
  return null;
}

function renderDiscordArtifactNudge(artifact: ScheduledWorkflowDeliveryArtifact): string {
  return `Tendnote ${artifact.workflow.replaceAll("_", " ")} is ready for review: ${artifact.summary}`;
}

function scrubDeliveryError(error: string): string {
  return error.replace(/\s+/g, " ").trim().slice(0, 500);
}
