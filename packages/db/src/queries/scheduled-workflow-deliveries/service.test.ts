import { describe, expect, it, vi } from "vitest";
import { createInMemoryScheduledWorkflowDeliveryStore } from "./in-memory-store";
import {
  createScheduledWorkflowDeliveryService,
  type DiscordInstallConsentResolver,
} from "./service";

function service() {
  return createScheduledWorkflowDeliveryService(createInMemoryScheduledWorkflowDeliveryStore());
}

function serviceWithConsent(resolveInstallConsent: DiscordInstallConsentResolver) {
  return createScheduledWorkflowDeliveryService(createInMemoryScheduledWorkflowDeliveryStore(), {
    resolveInstallConsent,
  });
}

function artifact(input: {
  ownerUserId?: string;
  workflow?: "morning_agenda" | "post_meeting_aftercare";
  artifactId?: string;
  sensitivity?: "normal" | "sensitive" | "restricted";
  scope?: "private" | "shared" | "household";
  householdId?: string | null;
}) {
  return {
    ownerUserId: input.ownerUserId ?? "owner-1",
    workflow: input.workflow ?? "morning_agenda",
    artifactKind: input.workflow ?? "morning_agenda",
    artifactId: input.artifactId ?? "artifact-1",
    sensitivity: input.sensitivity ?? "normal",
    ...(input.scope ? { scope: input.scope } : {}),
    ...(input.householdId !== undefined ? { householdId: input.householdId } : {}),
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

describe("scheduled workflow Discord delivery Phase 4 scope policy", () => {
  async function configure(
    workflowDelivery: ReturnType<typeof service>,
    overrides: Partial<{
      workflow: "morning_agenda" | "post_meeting_aftercare";
      targetId: string;
      targetScope: "private" | "shared" | "household";
      targetHouseholdId: string | null;
      allowSensitive: boolean;
      allowPrivateSummary: boolean;
    }> = {},
  ) {
    await workflowDelivery.configureDiscordWorkflowDelivery({
      ownerUserId: "owner-1",
      workflow: overrides.workflow ?? "morning_agenda",
      enabled: true,
      targetId: overrides.targetId ?? "discord-target",
      allowSensitive: overrides.allowSensitive ?? false,
      targetScope: overrides.targetScope ?? "private",
      targetHouseholdId: overrides.targetHouseholdId ?? null,
      allowPrivateSummary: overrides.allowPrivateSummary ?? false,
    });
  }

  it("delivers a private artifact to a private owner-only target", async () => {
    const workflowDelivery = service();
    const sender = vi.fn(async () => undefined);
    await configure(workflowDelivery, { targetScope: "private" });

    await expect(
      workflowDelivery.deliverDiscordScheduledArtifact({
        artifact: artifact({ artifactId: "private-to-private", scope: "private" }),
        sender,
      }),
    ).resolves.toMatchObject({ type: "sent" });
    expect(sender).toHaveBeenCalledOnce();
  });

  it("does not deliver a private artifact to a shared/household target by default", async () => {
    const workflowDelivery = service();
    const sender = vi.fn(async () => undefined);
    await configure(workflowDelivery, {
      targetScope: "household",
      targetHouseholdId: "household-1",
    });

    await expect(
      workflowDelivery.deliverDiscordScheduledArtifact({
        artifact: artifact({ artifactId: "private-to-shared", scope: "private" }),
        sender,
      }),
    ).resolves.toMatchObject({ type: "skipped", reason: "private_content_filtered" });
    expect(sender).not.toHaveBeenCalled();
  });

  it("treats an artifact with unknown scope as private (fail-closed) on a shared target", async () => {
    const workflowDelivery = service();
    const sender = vi.fn(async () => undefined);
    await configure(workflowDelivery, {
      targetScope: "household",
      targetHouseholdId: "household-1",
    });

    await expect(
      workflowDelivery.deliverDiscordScheduledArtifact({
        artifact: artifact({ artifactId: "unknown-scope" }),
        sender,
      }),
    ).resolves.toMatchObject({ type: "skipped", reason: "private_content_filtered" });
    expect(sender).not.toHaveBeenCalled();
  });

  it("delivers a private artifact's safe summary to a shared target when explicitly allowed", async () => {
    const workflowDelivery = service();
    const sender = vi.fn(async () => undefined);
    await configure(workflowDelivery, {
      targetScope: "household",
      targetHouseholdId: "household-1",
      allowPrivateSummary: true,
    });

    await expect(
      workflowDelivery.deliverDiscordScheduledArtifact({
        artifact: artifact({ artifactId: "private-summary-allowed", scope: "private" }),
        sender,
      }),
    ).resolves.toMatchObject({ type: "sent" });
    expect(sender).toHaveBeenCalledWith({
      targetId: "discord-target",
      content: "Tendnote morning agenda is ready for review: Three relationship prompts are ready.",
    });
  });

  it("delivers a household artifact only to a matching household-safe target", async () => {
    const workflowDelivery = service();
    const sender = vi.fn(async () => undefined);
    await configure(workflowDelivery, {
      targetScope: "household",
      targetHouseholdId: "household-1",
    });

    await expect(
      workflowDelivery.deliverDiscordScheduledArtifact({
        artifact: artifact({
          artifactId: "household-match",
          scope: "household",
          householdId: "household-1",
        }),
        sender,
      }),
    ).resolves.toMatchObject({ type: "sent" });
    expect(sender).toHaveBeenCalledOnce();
  });

  it("delivers a household artifact to the owner's private (owner-only) target", async () => {
    // Deviates from the AC's literal "only household-safe targets" wording: a
    // private target is owner-only, so delivering the owner's own household
    // artifact there discloses to no one else. Pinned as intentional (ADR-0141).
    const workflowDelivery = service();
    const sender = vi.fn(async () => undefined);
    await configure(workflowDelivery, { targetScope: "private" });

    await expect(
      workflowDelivery.deliverDiscordScheduledArtifact({
        artifact: artifact({
          artifactId: "household-to-private",
          scope: "household",
          householdId: "household-1",
        }),
        sender,
      }),
    ).resolves.toMatchObject({ type: "sent" });
    expect(sender).toHaveBeenCalledOnce();
  });

  it("reports a shared (selected-members) artifact on a shared target with its own reason", async () => {
    const workflowDelivery = service();
    const sender = vi.fn(async () => undefined);
    await configure(workflowDelivery, {
      targetScope: "household",
      targetHouseholdId: "household-1",
      allowPrivateSummary: true,
    });

    await expect(
      workflowDelivery.deliverDiscordScheduledArtifact({
        artifact: artifact({
          artifactId: "shared-scope",
          scope: "shared",
          householdId: "household-1",
        }),
        sender,
      }),
    ).resolves.toMatchObject({ type: "skipped", reason: "shared_content_filtered" });
    expect(sender).not.toHaveBeenCalled();
  });

  it("never compounds allowSensitive and allowPrivateSummary into a shared send", async () => {
    const workflowDelivery = service();
    const sender = vi.fn(async () => undefined);
    await configure(workflowDelivery, {
      targetScope: "household",
      targetHouseholdId: "household-1",
      allowSensitive: true,
      allowPrivateSummary: true,
    });

    await expect(
      workflowDelivery.deliverDiscordScheduledArtifact({
        artifact: artifact({
          artifactId: "sensitive-private-summary",
          scope: "private",
          sensitivity: "sensitive",
        }),
        sender,
      }),
    ).resolves.toMatchObject({ type: "skipped", reason: "private_content_filtered" });
    expect(sender).not.toHaveBeenCalled();
  });

  it("skips a household artifact when the target is not household-safe", async () => {
    const workflowDelivery = service();
    const sender = vi.fn(async () => undefined);
    await configure(workflowDelivery, { targetScope: "shared" });

    await expect(
      workflowDelivery.deliverDiscordScheduledArtifact({
        artifact: artifact({
          artifactId: "household-no-safe-target",
          scope: "household",
          householdId: "household-1",
        }),
        sender,
      }),
    ).resolves.toMatchObject({ type: "skipped", reason: "household_target_required" });
    expect(sender).not.toHaveBeenCalled();
  });

  it("skips a household artifact destined for a different household's target", async () => {
    const workflowDelivery = service();
    const sender = vi.fn(async () => undefined);
    await configure(workflowDelivery, {
      targetScope: "household",
      targetHouseholdId: "household-1",
    });

    await expect(
      workflowDelivery.deliverDiscordScheduledArtifact({
        artifact: artifact({
          artifactId: "household-cross",
          scope: "household",
          householdId: "household-2",
        }),
        sender,
      }),
    ).resolves.toMatchObject({ type: "skipped", reason: "household_target_mismatch" });
    expect(sender).not.toHaveBeenCalled();
  });

  it("records a skipped attempt for scope-filtered artifacts while the artifact stays reviewable", async () => {
    const workflowDelivery = service();
    const sender = vi.fn(async () => undefined);
    await configure(workflowDelivery, {
      targetScope: "household",
      targetHouseholdId: "household-1",
    });

    await workflowDelivery.deliverDiscordScheduledArtifact({
      artifact: artifact({ artifactId: "scope-skipped", scope: "private" }),
      sender,
    });

    await expect(
      workflowDelivery.listDeliveryAttemptsForArtifact({
        ownerUserId: "owner-1",
        artifactId: "scope-skipped",
      }),
    ).resolves.toMatchObject([
      { status: "skipped", reason: "private_content_filtered", targetId: "discord-target" },
    ]);
  });
});

describe("scheduled workflow Discord delivery send-time install consent (finding C)", () => {
  it("does not post after the install is paused (consent fails closed)", async () => {
    // The per-workflow setting still records an enabled target, but the owner has
    // paused the install: the send-time consent resolver returns null, so the send
    // must fail closed even though the stale setting still looks deliverable.
    const consent = vi.fn<DiscordInstallConsentResolver>(async () => null);
    const workflowDelivery = serviceWithConsent(consent);
    const sender = vi.fn(async () => undefined);
    await workflowDelivery.configureDiscordWorkflowDelivery({
      ownerUserId: "owner-1",
      workflow: "morning_agenda",
      enabled: true,
      targetId: "discord-channel-old",
      allowSensitive: false,
    });

    await expect(
      workflowDelivery.deliverDiscordScheduledArtifact({
        artifact: artifact({ artifactId: "paused-install" }),
        sender,
      }),
    ).resolves.toMatchObject({
      type: "skipped",
      reason: "discord_install_unavailable",
      attempt: { status: "skipped", reason: "discord_install_unavailable" },
    });
    expect(sender).not.toHaveBeenCalled();
    expect(consent).toHaveBeenCalledWith({ ownerUserId: "owner-1" });
  });

  it("delivers only to the install's current channel after the target changes", async () => {
    // The stored setting still points at the old channel; the live install now
    // points at a new one. The send must land on the new channel and never the old.
    const consent = vi.fn<DiscordInstallConsentResolver>(async () => ({
      targetChannelId: "discord-channel-new",
    }));
    const workflowDelivery = serviceWithConsent(consent);
    const sender = vi.fn(async () => undefined);
    await workflowDelivery.configureDiscordWorkflowDelivery({
      ownerUserId: "owner-1",
      workflow: "morning_agenda",
      enabled: true,
      targetId: "discord-channel-old",
      allowSensitive: false,
    });

    await expect(
      workflowDelivery.deliverDiscordScheduledArtifact({
        artifact: artifact({ artifactId: "channel-changed" }),
        sender,
      }),
    ).resolves.toMatchObject({
      type: "sent",
      attempt: { status: "sent", targetId: "discord-channel-new" },
    });
    expect(sender).toHaveBeenCalledOnce();
    expect(sender).toHaveBeenCalledWith({
      targetId: "discord-channel-new",
      content: "Tendnote morning agenda is ready for review: Three relationship prompts are ready.",
    });
  });

  it("still enforces the setting's disclosure policy on top of a live install channel", async () => {
    // A live install channel does not bypass sensitivity gating: a sensitive
    // artifact on a non-allowSensitive target is still filtered.
    const consent = vi.fn<DiscordInstallConsentResolver>(async () => ({
      targetChannelId: "discord-channel-new",
    }));
    const workflowDelivery = serviceWithConsent(consent);
    const sender = vi.fn(async () => undefined);
    await workflowDelivery.configureDiscordWorkflowDelivery({
      ownerUserId: "owner-1",
      workflow: "morning_agenda",
      enabled: true,
      targetId: "discord-channel-old",
      allowSensitive: false,
    });

    await expect(
      workflowDelivery.deliverDiscordScheduledArtifact({
        artifact: artifact({ artifactId: "sensitive-live", sensitivity: "sensitive" }),
        sender,
      }),
    ).resolves.toMatchObject({ type: "skipped", reason: "sensitive_content_filtered" });
    expect(sender).not.toHaveBeenCalled();
  });
});
