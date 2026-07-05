import type { SourceRecord } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import {
  createDiscordOwnerResolver,
  type DiscordCaptureDeps,
  decodeDiscordComponentCustomId,
  discordClarificationComponents,
  discordClarificationModal,
  discordOwnerMapResolver,
  discordReviewComponents,
  encodeDiscordComponentCustomId,
  handleDiscordCaptureInteraction,
  parseDiscordOwnerMap,
} from "../agent/lib/discord-capture";
import { modeAllowsTool } from "../agent/lib/eve-modes";

function sourceRecord(input: {
  id: string;
  ownerUserId: string;
  content: string;
  metadataJson?: Record<string, unknown>;
}): SourceRecord {
  return {
    id: input.id,
    ownerUserId: input.ownerUserId,
    sourceType: "agent",
    content: input.content,
    rawContent: null,
    retentionPolicy: "retain",
    status: "active",
    confidence: "medium",
    sensitivity: "normal",
    scope: "private",
    importance: 3,
    metadataJson: input.metadataJson ?? {},
    createdAt: new Date("2026-07-02T00:00:00.000Z"),
    updatedAt: new Date("2026-07-02T00:00:00.000Z"),
  };
}

function deps(): DiscordCaptureDeps {
  return {
    captureForPerson: vi.fn(async (input) => ({
      sourceRecord: sourceRecord({
        id: "source-person",
        ownerUserId: input.ownerUserId,
        content: input.retainedContent,
        metadataJson: input.metadataJson ?? null,
      }),
      component: { type: "source_record_review" as const, sourceRecordId: "source-person" },
    })),
    captureGlobal: vi.fn(async (input) => ({
      sourceRecord: sourceRecord({
        id: "source-global",
        ownerUserId: input.ownerUserId,
        content: input.retainedContent,
        metadataJson: input.metadataJson ?? null,
      }),
      component: { type: "source_record_review" as const, sourceRecordId: "source-global" },
    })),
    enqueueExtraction: vi.fn(async () => undefined),
    parkHitlSession: vi.fn(async () => undefined),
    resumeHitlSession: vi.fn(async () => undefined),
  };
}

describe("Discord private capture channel", () => {
  it("parses the documented owner map formats", () => {
    expect(parseDiscordOwnerMap("discord-1:owner-1, discord-2:owner-2")).toEqual({
      "discord-1": "owner-1",
      "discord-2": "owner-2",
    });
    expect(parseDiscordOwnerMap('{"discord-3":"owner-3"}')).toEqual({ "discord-3": "owner-3" });
  });

  it("maps a Discord slash capture to an owner-scoped Source Record", async () => {
    const captureDeps = deps();

    const result = await handleDiscordCaptureInteraction(
      {
        type: "slash_command",
        commandName: "capture",
        discordUserId: "discord-1",
        content: "Met Jo for coffee and they mentioned moving in August.",
      },
      captureDeps,
      discordOwnerMapResolver({ "discord-1": "owner-1" }),
    );

    expect(result).toMatchObject({
      type: "captured",
      ownerUserId: "owner-1",
      sourceRecord: {
        id: "source-global",
        status: "active",
      },
      linkedPersonId: null,
      reviewRequired: true,
      durablePromotions: [],
      components: [
        {
          type: "action_row",
          components: [
            {
              type: "button",
              style: "secondary",
              customId: "review:source-global",
              label: "Review in Tendnote",
            },
          ],
        },
      ],
    });
    expect(captureDeps.captureGlobal).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        retainedContent: "Met Jo for coffee and they mentioned moving in August.",
        metadataJson: { captureSurface: "discord" },
      }),
    );
    expect(captureDeps.enqueueExtraction).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      sourceRecordId: "source-global",
    });
  });

  it("parks HITL component and modal replies without creating durable truth", async () => {
    const captureDeps = deps();

    const result = await handleDiscordCaptureInteraction(
      {
        type: "modal_submit",
        discordUserId: "discord-1",
        sessionId: "session-1",
        action: "clarify",
        value: "I meant Jo Rivera.",
      },
      captureDeps,
      discordOwnerMapResolver({ "discord-1": "owner-1" }),
    );

    expect(result).toEqual({
      type: "parked_session",
      ownerUserId: "owner-1",
      sessionId: "session-1",
      action: "clarify",
      value: "I meant Jo Rivera.",
    });
    expect(captureDeps.parkHitlSession).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      discordUserId: "discord-1",
      sessionId: "session-1",
      action: "clarify",
      value: "I meant Jo Rivera.",
    });
    expect(captureDeps.resumeHitlSession).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      discordUserId: "discord-1",
      sessionId: "session-1",
      action: "clarify",
      value: "I meant Jo Rivera.",
    });
    expect(captureDeps.captureGlobal).not.toHaveBeenCalled();
    expect(captureDeps.captureForPerson).not.toHaveBeenCalled();
  });

  it("rejects unmapped users and inbound attachments", async () => {
    const captureDeps = deps();

    await expect(
      handleDiscordCaptureInteraction(
        {
          type: "slash_command",
          commandName: "capture",
          discordUserId: "unknown",
          content: "Remember this.",
        },
        captureDeps,
        discordOwnerMapResolver({ "discord-1": "owner-1" }),
      ),
    ).resolves.toEqual({ type: "rejected", reason: "unmapped_discord_user" });

    await expect(
      handleDiscordCaptureInteraction(
        {
          type: "slash_command",
          commandName: "capture",
          discordUserId: "discord-1",
          content: "Import this file.",
          attachments: [{ id: "file-1", filename: "contacts.csv" }],
        },
        captureDeps,
        discordOwnerMapResolver({ "discord-1": "owner-1" }),
      ),
    ).resolves.toEqual({ type: "rejected", reason: "attachments_not_supported" });
  });

  it("does not expose durable-truth promotion tools in Discord Capture Mode", () => {
    expect(modeAllowsTool("discord_capture", "approve_suggested_memory")).toBe(false);
    expect(modeAllowsTool("discord_capture", "propose_followup")).toBe(false);
    expect(modeAllowsTool("discord_capture", "create_message_draft")).toBe(false);
  });

  it("uses typed Discord component ids for review buttons and clarification modals", () => {
    expect(encodeDiscordComponentCustomId({ action: "review", sessionId: "source-1" })).toBe(
      "review:source-1",
    );
    expect(decodeDiscordComponentCustomId("clarify:session-1")).toEqual({
      action: "clarify",
      sessionId: "session-1",
    });
    expect(discordReviewComponents("source-1")[0]?.components[0]?.customId).toBe("review:source-1");
    expect(discordClarificationComponents("session-1")[0]?.components[0]?.customId).toBe(
      "clarify:session-1",
    );
    expect(discordClarificationModal("session-1")).toMatchObject({
      customId: "clarify:session-1",
      components: [{ components: [{ type: "text_input", customId: "clarification" }] }],
    });
  });
});

describe("Discord owner resolution ordering", () => {
  it("prefers persisted identity over the dev env-map fallback", async () => {
    const resolve = createDiscordOwnerResolver({
      resolvePersistedOwner: async (discordUserId) =>
        discordUserId === "discord-1" ? "persisted-owner" : null,
      devFallback: discordOwnerMapResolver({ "discord-1": "env-owner" }),
    });

    await expect(resolve("discord-1")).resolves.toBe("persisted-owner");
  });

  it("falls back to the dev env map only when persisted identity is absent", async () => {
    const resolve = createDiscordOwnerResolver({
      resolvePersistedOwner: async () => null,
      devFallback: discordOwnerMapResolver({ "discord-2": "env-owner" }),
    });

    await expect(resolve("discord-2")).resolves.toBe("env-owner");
  });

  it("fails closed when there is no persisted identity and no dev fallback", async () => {
    const resolve = createDiscordOwnerResolver({
      resolvePersistedOwner: async () => null,
      devFallback: null,
    });

    await expect(resolve("discord-1")).resolves.toBeNull();
  });

  it("rejects an unmapped Discord user without writing any Tendnote context", async () => {
    const captureDeps = deps();
    const resolve = createDiscordOwnerResolver({
      resolvePersistedOwner: async () => null,
      devFallback: null,
    });

    const result = await handleDiscordCaptureInteraction(
      {
        type: "slash_command",
        commandName: "capture",
        discordUserId: "unmapped",
        content: "Remember this.",
      },
      captureDeps,
      resolve,
    );

    expect(result).toEqual({ type: "rejected", reason: "unmapped_discord_user" });
    expect(captureDeps.captureGlobal).not.toHaveBeenCalled();
    expect(captureDeps.captureForPerson).not.toHaveBeenCalled();
    expect(captureDeps.enqueueExtraction).not.toHaveBeenCalled();
    expect(captureDeps.parkHitlSession).not.toHaveBeenCalled();
    expect(captureDeps.resumeHitlSession).not.toHaveBeenCalled();
  });

  it("resolves two Discord users in the same guild to different owners without cross-writing", async () => {
    const resolve = createDiscordOwnerResolver({
      resolvePersistedOwner: async (discordUserId) =>
        ({ "discord-1": "owner-1", "discord-2": "owner-2" })[discordUserId] ?? null,
    });

    const depsOne = deps();
    const resultOne = await handleDiscordCaptureInteraction(
      {
        type: "slash_command",
        commandName: "capture",
        discordUserId: "discord-1",
        content: "Owner one context.",
      },
      depsOne,
      resolve,
    );

    const depsTwo = deps();
    const resultTwo = await handleDiscordCaptureInteraction(
      {
        type: "slash_command",
        commandName: "capture",
        discordUserId: "discord-2",
        content: "Owner two context.",
      },
      depsTwo,
      resolve,
    );

    expect(resultOne).toMatchObject({ type: "captured", ownerUserId: "owner-1" });
    expect(resultTwo).toMatchObject({ type: "captured", ownerUserId: "owner-2" });
    expect(depsOne.captureGlobal).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "owner-1" }),
    );
    expect(depsTwo.captureGlobal).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "owner-2" }),
    );
    expect(depsOne.captureGlobal).not.toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "owner-2" }),
    );
  });
});
