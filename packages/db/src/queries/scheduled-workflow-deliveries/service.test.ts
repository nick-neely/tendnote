import { describe, expect, it, vi } from "vitest";
import { createInMemoryScheduledWorkflowDeliveryStore } from "./in-memory-store";
import { createScheduledWorkflowDeliveryService } from "./service";

function service() {
  return createScheduledWorkflowDeliveryService(createInMemoryScheduledWorkflowDeliveryStore());
}

function artifact(input: {
  workflow?: "morning_agenda" | "post_meeting_aftercare";
  artifactId?: string;
  sensitivity?: "normal" | "sensitive" | "restricted";
}) {
  return {
    ownerUserId: "owner-1",
    workflow: input.workflow ?? "morning_agenda",
    artifactKind: input.workflow ?? "morning_agenda",
    artifactId: input.artifactId ?? "artifact-1",
    sensitivity: input.sensitivity ?? "normal",
    persisted: true,
    summary: "Three relationship prompts are ready.",
  } as const;
}

describe("scheduled workflow Discord delivery settings", () => {
  it("configures Discord targets independently per eligible workflow", async () => {
    const workflowDelivery = service();

    await workflowDelivery.configureDiscordWorkflowDelivery({
      ownerUserId: "owner-1",
      workflow: "morning_agenda",
      enabled: true,
      targetId: "discord-channel-morning",
      allowSensitive: false,
    });
    await workflowDelivery.configureDiscordWorkflowDelivery({
      ownerUserId: "owner-1",
      workflow: "post_meeting_aftercare",
      enabled: true,
      targetId: "discord-channel-aftercare",
      allowSensitive: true,
    });

    await expect(
      workflowDelivery.listWorkflowDeliverySettingsForOwner({ ownerUserId: "owner-1" }),
    ).resolves.toMatchObject([
      { workflow: "morning_agenda", targetId: "discord-channel-morning", allowSensitive: false },
      {
        workflow: "post_meeting_aftercare",
        targetId: "discord-channel-aftercare",
        allowSensitive: true,
      },
    ]);
  });

  it("skips delivery when the workflow has no configured Discord target", async () => {
    const workflowDelivery = service();
    const sender = vi.fn(async () => undefined);

    const result = await workflowDelivery.deliverDiscordScheduledArtifact({
      artifact: artifact({ artifactId: "artifact-missing-target" }),
      sender,
    });

    expect(result).toMatchObject({
      type: "skipped",
      reason: "missing_discord_target",
      attempt: { status: "skipped", targetId: null },
    });
    expect(sender).not.toHaveBeenCalled();
    await expect(
      workflowDelivery.listDeliveryAttemptsForArtifact({
        ownerUserId: "owner-1",
        artifactId: "artifact-missing-target",
      }),
    ).resolves.toHaveLength(1);
  });

  it("skips delivery when a Discord target is configured but disabled", async () => {
    const workflowDelivery = service();
    await workflowDelivery.configureDiscordWorkflowDelivery({
      ownerUserId: "owner-1",
      workflow: "morning_agenda",
      enabled: false,
      targetId: "discord-channel-morning",
      allowSensitive: false,
    });
    const sender = vi.fn(async () => undefined);

    await expect(
      workflowDelivery.deliverDiscordScheduledArtifact({
        artifact: artifact({ artifactId: "artifact-disabled" }),
        sender,
      }),
    ).resolves.toMatchObject({
      type: "skipped",
      reason: "discord_delivery_disabled",
      attempt: { status: "skipped", targetId: "discord-channel-morning" },
    });
    expect(sender).not.toHaveBeenCalled();
  });

  it("persists an attempt and leaves the artifact recoverable when Discord send fails", async () => {
    const workflowDelivery = service();
    await workflowDelivery.configureDiscordWorkflowDelivery({
      ownerUserId: "owner-1",
      workflow: "morning_agenda",
      enabled: true,
      targetId: "discord-channel-morning",
      allowSensitive: false,
    });
    const sender = vi.fn(async () => {
      throw new Error("Discord API unavailable");
    });

    const result = await workflowDelivery.deliverDiscordScheduledArtifact({
      artifact: artifact({ artifactId: "artifact-failed" }),
      sender,
    });

    expect(result).toMatchObject({
      type: "failed",
      attempt: {
        artifactId: "artifact-failed",
        status: "failed",
        reason: "discord_send_failed",
        error: "Discord API unavailable",
      },
    });
    await expect(
      workflowDelivery.listDeliveryAttemptsForArtifact({
        ownerUserId: "owner-1",
        artifactId: "artifact-failed",
      }),
    ).resolves.toMatchObject([{ status: "failed", targetId: "discord-channel-morning" }]);
    await expect(
      workflowDelivery.listDeliveryAttemptsForOwner({ ownerUserId: "owner-1", status: "failed" }),
    ).resolves.toMatchObject([{ artifactId: "artifact-failed", error: "Discord API unavailable" }]);
  });

  it("delivers normal artifacts only after the artifact is already persisted", async () => {
    const workflowDelivery = service();
    await workflowDelivery.configureDiscordWorkflowDelivery({
      ownerUserId: "owner-1",
      workflow: "morning_agenda",
      enabled: true,
      targetId: "discord-channel-morning",
      allowSensitive: false,
    });
    const sender = vi.fn(async () => undefined);
    const unpersistedArtifact = {
      ...artifact({ artifactId: "artifact-unpersisted" }),
      persisted: false,
    };

    await expect(
      workflowDelivery.deliverDiscordScheduledArtifact({
        artifact: unpersistedArtifact as never,
        sender,
      }),
    ).rejects.toThrow(/persisted before Discord delivery/);

    await expect(
      workflowDelivery.deliverDiscordScheduledArtifact({
        artifact: artifact({ artifactId: "artifact-sent" }),
        sender,
      }),
    ).resolves.toMatchObject({
      type: "sent",
      attempt: { artifactId: "artifact-sent", status: "sent" },
    });
    expect(sender).toHaveBeenCalledWith({
      targetId: "discord-channel-morning",
      content: "Tendnote morning agenda is ready for review: Three relationship prompts are ready.",
    });
  });

  it("filters sensitive and restricted artifacts unless policy explicitly allows safe sensitive nudges", async () => {
    const workflowDelivery = service();
    const sender = vi.fn(async () => undefined);
    await workflowDelivery.configureDiscordWorkflowDelivery({
      ownerUserId: "owner-1",
      workflow: "morning_agenda",
      enabled: true,
      targetId: "discord-channel-morning",
      allowSensitive: false,
    });
    await workflowDelivery.configureDiscordWorkflowDelivery({
      ownerUserId: "owner-1",
      workflow: "post_meeting_aftercare",
      enabled: true,
      targetId: "discord-channel-aftercare",
      allowSensitive: true,
    });

    await expect(
      workflowDelivery.deliverDiscordScheduledArtifact({
        artifact: artifact({ artifactId: "artifact-sensitive", sensitivity: "sensitive" }),
        sender,
      }),
    ).resolves.toMatchObject({ type: "skipped", reason: "sensitive_content_filtered" });

    await expect(
      workflowDelivery.deliverDiscordScheduledArtifact({
        artifact: artifact({
          workflow: "post_meeting_aftercare",
          artifactId: "artifact-sensitive-allowed",
          sensitivity: "sensitive",
        }),
        sender,
      }),
    ).resolves.toMatchObject({ type: "sent" });

    await expect(
      workflowDelivery.deliverDiscordScheduledArtifact({
        artifact: artifact({
          workflow: "post_meeting_aftercare",
          artifactId: "artifact-restricted",
          sensitivity: "restricted",
        }),
        sender,
      }),
    ).resolves.toMatchObject({ type: "skipped", reason: "restricted_content_filtered" });
  });
});
