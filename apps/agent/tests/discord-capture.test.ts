import {
  createInMemorySourceRecordStore,
  createSourceRecordCapture,
} from "@tendnote/db/queries/source-records";
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
import {
  HOUSEHOLD_MEMBER_ID,
  HOUSEHOLD_OWNER_ID,
  REMOVED_MEMBER_ID,
  seedHouseholdWithMembers,
} from "./fixtures/household";

/**
 * Discord capture deps backed by the real in-memory Source Record store, so
 * assertions read persisted storage behavior rather than mock pass-through.
 * `captureForPerson` is unused by these global-capture paths.
 */
function realStoreCaptureDeps() {
  const store = createInMemorySourceRecordStore();
  const capture = createSourceRecordCapture(store);
  const deps: DiscordCaptureDeps = {
    captureGlobal: (input) => capture.captureSourceRecord(input),
    captureForPerson: async () => {
      throw new Error("captureForPerson is not exercised by these household-safety tests");
    },
    enqueueExtraction: vi.fn(async () => undefined),
    parkHitlSession: vi.fn(async () => undefined),
    resumeHitlSession: vi.fn(async () => undefined),
  };
  return { store, deps };
}

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

describe("Discord capture is household-safe (private owner scope only)", () => {
  it("persists a private owner-scoped record even when guild and channel context is present", async () => {
    const { store, deps: captureDeps } = realStoreCaptureDeps();

    const result = await handleDiscordCaptureInteraction(
      {
        type: "slash_command",
        commandName: "capture",
        discordUserId: "discord-1",
        content: "Met Jo for coffee.",
        guildId: "guild-shared",
        channelId: "channel-shared",
      },
      captureDeps,
      discordOwnerMapResolver({ "discord-1": "owner-1" }),
    );

    if (result.type !== "captured") throw new Error("expected a captured result");

    // Read the actually-persisted record back, not the handler's echoed fields:
    // guild/channel membership must never widen scope beyond private owner context.
    const persisted = await store.getSourceRecordById(result.sourceRecord.id);
    expect(persisted?.scope).toBe("private");
    expect(persisted?.ownerUserId).toBe("owner-1");
    expect(persisted?.metadataJson).toMatchObject({ captureSurface: "discord" });
  });

  it("rejects an explicit non-private scope from Discord without writing any context", async () => {
    const { deps: captureDeps } = realStoreCaptureDeps();
    const captureGlobalSpy = vi.spyOn(captureDeps, "captureGlobal");

    const result = await handleDiscordCaptureInteraction(
      {
        type: "slash_command",
        commandName: "capture",
        discordUserId: "discord-1",
        content: "Share this with the whole house.",
        guildId: "guild-shared",
        requestedScope: "household",
      },
      captureDeps,
      discordOwnerMapResolver({ "discord-1": "owner-1" }),
    );

    expect(result).toEqual({ type: "rejected", reason: "household_scope_not_supported" });
    expect(captureGlobalSpy).not.toHaveBeenCalled();
    expect(captureDeps.enqueueExtraction).not.toHaveBeenCalled();
  });

  it("keeps a household owner and member's Discord captures private through the real visibility path", async () => {
    const { canView } = await seedHouseholdWithMembers();
    const resolve = discordOwnerMapResolver({
      "discord-owner": HOUSEHOLD_OWNER_ID,
      "discord-member": HOUSEHOLD_MEMBER_ID,
    });
    const owner = realStoreCaptureDeps();
    const member = realStoreCaptureDeps();

    const ownerResult = await handleDiscordCaptureInteraction(
      {
        type: "slash_command",
        commandName: "capture",
        discordUserId: "discord-owner",
        content: "Owner's private note.",
        guildId: "guild-shared",
      },
      owner.deps,
      resolve,
    );
    const memberResult = await handleDiscordCaptureInteraction(
      {
        type: "slash_command",
        commandName: "capture",
        discordUserId: "discord-member",
        content: "Member's private note.",
        guildId: "guild-shared",
      },
      member.deps,
      resolve,
    );

    if (ownerResult.type !== "captured" || memberResult.type !== "captured") {
      throw new Error("expected both Discord captures to succeed");
    }

    const ownerRecord = await owner.store.getSourceRecordById(ownerResult.sourceRecord.id);
    const memberRecord = await member.store.getSourceRecordById(memberResult.sourceRecord.id);
    if (!ownerRecord || !memberRecord) throw new Error("expected persisted records");

    // Both share one active household, yet each Discord capture is private
    // owner-scoped (household id null), so neither can see the other's through
    // the real Phase 4 visibility query.
    expect(await canView({ callerUserId: HOUSEHOLD_MEMBER_ID, record: ownerRecord })).toBe(false);
    expect(await canView({ callerUserId: HOUSEHOLD_OWNER_ID, record: memberRecord })).toBe(false);

    // Each owner can still see their own capture.
    expect(await canView({ callerUserId: HOUSEHOLD_OWNER_ID, record: ownerRecord })).toBe(true);
    expect(await canView({ callerUserId: HOUSEHOLD_MEMBER_ID, record: memberRecord })).toBe(true);
  });

  it("preserves scope and provenance when a genuinely household-scoped record is surfaced", async () => {
    // A record made household-scoped through an explicit in-product choice
    // (never from Discord) must keep its scope AND its provenance when surfaced
    // through the same real Phase 4-safe visibility query.
    const { householdId, canView } = await seedHouseholdWithMembers();
    const store = createInMemorySourceRecordStore();
    const householdRecord = await store.createSourceRecord({
      ownerUserId: HOUSEHOLD_OWNER_ID,
      householdId,
      content: "Shared house note everyone should see.",
      scope: "household",
      metadataJson: { captureSurface: "person_assistant" },
    });

    const persisted = await store.getSourceRecordById(householdRecord.id);
    if (!persisted) throw new Error("expected persisted household record");
    // Provenance/scope survive the storage round-trip.
    expect(persisted.scope).toBe("household");
    expect(persisted.householdId).toBe(householdId);
    expect(persisted.metadataJson).toMatchObject({ captureSurface: "person_assistant" });

    // An active member can see the household-scoped record...
    expect(await canView({ callerUserId: HOUSEHOLD_MEMBER_ID, record: persisted })).toBe(true);
    // ...while a removed member loses visibility.
    expect(await canView({ callerUserId: REMOVED_MEMBER_ID, record: persisted })).toBe(false);
  });
});
