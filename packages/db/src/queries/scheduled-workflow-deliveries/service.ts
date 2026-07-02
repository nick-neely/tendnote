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

export type DeliverDiscordScheduledArtifactInput = {
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

  if (artifact.sensitivity === "restricted") {
    return "restricted_content_filtered";
  }

  if (artifact.sensitivity === "sensitive" && !setting.allowSensitive) {
    return "sensitive_content_filtered";
  }

  return null;
}

function renderDiscordArtifactNudge(artifact: ScheduledWorkflowDeliveryArtifact): string {
  return `Tendnote ${artifact.workflow.replaceAll("_", " ")} is ready for review: ${artifact.summary}`;
}

function scrubDeliveryError(error: string): string {
  return error.replace(/\s+/g, " ").trim().slice(0, 500);
}
