import { generateKeyPairSync, sign } from "node:crypto";
import type { SourceRecord } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import {
  discordApiPayloadToCaptureInteraction,
  getParkedDiscordHitlSession,
  getResumedDiscordHitlSession,
  handleDiscordRequest,
  parkDiscordHitlSession,
  registerDiscordHitlSessionResumeHandler,
  renderDiscordHitlPrompt,
  resumeDiscordHitlSession,
  verifyDiscordSignature,
} from "../agent/channels/discord";
import type { DiscordCaptureDeps } from "../agent/lib/discord-capture";

function signDiscordBody(body: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const exported = publicKey.export({ format: "der", type: "spki" });
  const publicKeyHex = exported.subarray(exported.length - 32).toString("hex");
  const timestamp = "1783000000";
  const signature = sign(null, Buffer.from(`${timestamp}${body}`), privateKey).toString("hex");

  return {
    publicKeyHex,
    headers: new Headers({
      "x-signature-ed25519": signature,
      "x-signature-timestamp": timestamp,
    }),
  };
}

function sourceRecord(id: string, ownerUserId: string, content: string): SourceRecord {
  return {
    id,
    ownerUserId,
    sourceType: "agent",
    content,
    rawContent: null,
    retentionPolicy: "retain",
    status: "active",
    confidence: "medium",
    sensitivity: "normal",
    scope: "private",
    importance: 3,
    metadataJson: { captureSurface: "discord" },
    createdAt: new Date("2026-07-02T00:00:00.000Z"),
    updatedAt: new Date("2026-07-02T00:00:00.000Z"),
  };
}

function deps(): DiscordCaptureDeps {
  return {
    captureForPerson: vi.fn(async (input) => ({
      sourceRecord: sourceRecord("source-person", input.ownerUserId, input.retainedContent),
      component: { type: "source_record_review" as const, sourceRecordId: "source-person" },
    })),
    captureGlobal: vi.fn(async (input) => ({
      sourceRecord: sourceRecord("source-global", input.ownerUserId, input.retainedContent),
      component: { type: "source_record_review" as const, sourceRecordId: "source-global" },
    })),
    enqueueExtraction: vi.fn(async () => undefined),
    parkHitlSession: vi.fn(async () => undefined),
    resumeHitlSession: vi.fn(async () => undefined),
  };
}

describe("Discord interaction channel", () => {
  it("verifies Discord Ed25519 request signatures", () => {
    const body = JSON.stringify({ type: 1 });
    const signed = signDiscordBody(body);

    expect(verifyDiscordSignature(signed.headers, body, signed.publicKeyHex)).toBe(true);
    expect(verifyDiscordSignature(signed.headers, `${body} `, signed.publicKeyHex)).toBe(false);
  });

  it("parses slash commands, components, modals, and attachment rejection context", () => {
    expect(
      discordApiPayloadToCaptureInteraction({
        type: 2,
        member: { user: { id: "discord-1" } },
        data: {
          name: "capture",
          options: [{ name: "message", type: 3, value: "Lunch with Sam" }],
        },
      }),
    ).toEqual({
      type: "slash_command",
      commandName: "capture",
      discordUserId: "discord-1",
      content: "Lunch with Sam",
    });

    expect(
      discordApiPayloadToCaptureInteraction({
        type: 3,
        user: { id: "discord-1" },
        data: { custom_id: "review:session-1" },
      }),
    ).toEqual({
      type: "component",
      discordUserId: "discord-1",
      sessionId: "session-1",
      action: "review",
      value: undefined,
    });

    expect(
      discordApiPayloadToCaptureInteraction({
        type: 2,
        user: { id: "discord-1" },
        data: {
          name: "capture",
          options: [{ name: "message", type: 3, value: "Import this" }],
          resolved: { attachments: { "file-1": { filename: "contacts.csv" } } },
        },
      }),
    ).toMatchObject({ attachments: [{ id: "file-1", filename: "contacts.csv" }] });
  });

  it("responds to a signed slash command with review-only capture components", async () => {
    const body = JSON.stringify({
      type: 2,
      member: { user: { id: "discord-1" } },
      data: {
        name: "capture",
        options: [{ name: "message", type: 3, value: "Lunch with Sam" }],
      },
    });
    const signed = signDiscordBody(body);
    const captureDeps = deps();

    const response = await handleDiscordRequest(
      new Request("https://example.com/eve/v1/discord", {
        method: "POST",
        body,
        headers: signed.headers,
      }),
      {
        publicKey: signed.publicKeyHex,
        ownerMapRaw: "discord-1:owner-1",
        deps: captureDeps,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      type: 4,
      data: {
        content: "Captured as Tendnote logged context for review.",
        flags: 64,
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 2,
                custom_id: "review:source-global",
                label: "Review in Tendnote",
              },
            ],
          },
        ],
      },
    });
    expect(captureDeps.captureGlobal).toHaveBeenCalledOnce();
    expect(captureDeps.captureForPerson).not.toHaveBeenCalled();
  });

  it("returns a controlled error for signed malformed JSON", async () => {
    const body = "{";
    const signed = signDiscordBody(body);
    const captureDeps = deps();

    const response = await handleDiscordRequest(
      new Request("https://example.com/eve/v1/discord", {
        method: "POST",
        body,
        headers: signed.headers,
      }),
      {
        publicKey: signed.publicKeyHex,
        ownerMapRaw: "discord-1:owner-1",
        deps: captureDeps,
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid Discord interaction payload",
    });
    expect(captureDeps.captureGlobal).not.toHaveBeenCalled();
  });

  it("opens a Discord modal when a signed clarification button is clicked", async () => {
    const body = JSON.stringify({
      type: 3,
      user: { id: "discord-1" },
      data: { custom_id: "clarify:session-1" },
    });
    const signed = signDiscordBody(body);
    const captureDeps = deps();

    const response = await handleDiscordRequest(
      new Request("https://example.com/eve/v1/discord", {
        method: "POST",
        body,
        headers: signed.headers,
      }),
      {
        publicKey: signed.publicKeyHex,
        ownerMapRaw: "discord-1:owner-1",
        deps: captureDeps,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      type: 9,
      data: {
        custom_id: "clarify:session-1",
        components: [{ components: [{ type: 4, custom_id: "clarification" }] }],
      },
    });
    expect(captureDeps.parkHitlSession).not.toHaveBeenCalled();
    expect(captureDeps.resumeHitlSession).not.toHaveBeenCalled();
  });

  it("acknowledges review buttons without treating source records as HITL sessions", async () => {
    const body = JSON.stringify({
      type: 3,
      user: { id: "discord-1" },
      data: { custom_id: "review:source-global" },
    });
    const signed = signDiscordBody(body);
    const captureDeps = deps();

    const response = await handleDiscordRequest(
      new Request("https://example.com/eve/v1/discord", {
        method: "POST",
        body,
        headers: signed.headers,
      }),
      {
        publicKey: signed.publicKeyHex,
        ownerMapRaw: "discord-1:owner-1",
        deps: captureDeps,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      type: 4,
      data: {
        content: "Open Tendnote to review Source Record source-global.",
        flags: 64,
      },
    });
    expect(captureDeps.parkHitlSession).not.toHaveBeenCalled();
    expect(captureDeps.resumeHitlSession).not.toHaveBeenCalled();
    expect(captureDeps.captureGlobal).not.toHaveBeenCalled();
  });

  it("parks and resumes signed HITL modal replies", async () => {
    const body = JSON.stringify({
      type: 5,
      user: { id: "discord-1" },
      data: {
        custom_id: "clarify:session-1",
        components: [{ components: [{ custom_id: "clarification", value: "I meant Sam Lee." }] }],
      },
    });
    const signed = signDiscordBody(body);
    const captureDeps = deps();

    const response = await handleDiscordRequest(
      new Request("https://example.com/eve/v1/discord", {
        method: "POST",
        body,
        headers: signed.headers,
      }),
      {
        publicKey: signed.publicKeyHex,
        ownerMapRaw: "discord-1:owner-1",
        deps: captureDeps,
      },
    );

    expect(response.status).toBe(200);
    expect(captureDeps.parkHitlSession).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      discordUserId: "discord-1",
      sessionId: "session-1",
      action: "clarify",
      value: "I meant Sam Lee.",
    });
    expect(captureDeps.resumeHitlSession).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      discordUserId: "discord-1",
      sessionId: "session-1",
      action: "clarify",
      value: "I meant Sam Lee.",
    });
    expect(captureDeps.captureGlobal).not.toHaveBeenCalled();
  });

  it("has live HITL parking and resume for default Discord channel wiring", async () => {
    const resumeHandler = vi.fn(async () => undefined);
    const unregister = registerDiscordHitlSessionResumeHandler("session-live", resumeHandler);
    await parkDiscordHitlSession({
      ownerUserId: "owner-1",
      discordUserId: "discord-1",
      sessionId: "session-live",
      action: "review",
      value: "Looks right.",
    });
    await resumeDiscordHitlSession({
      ownerUserId: "owner-1",
      discordUserId: "discord-1",
      sessionId: "session-live",
      action: "review",
      value: "Looks right.",
    });

    expect(getParkedDiscordHitlSession("session-live")).toMatchObject({
      ownerUserId: "owner-1",
      discordUserId: "discord-1",
      sessionId: "session-live",
      action: "review",
      value: "Looks right.",
    });
    expect(getResumedDiscordHitlSession("session-live")).toMatchObject({
      ownerUserId: "owner-1",
      discordUserId: "discord-1",
      sessionId: "session-live",
      action: "review",
      value: "Looks right.",
    });
    expect(resumeHandler).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      discordUserId: "discord-1",
      sessionId: "session-live",
      action: "review",
      value: "Looks right.",
    });
    unregister();
  });

  it("does not silently resume when no HITL continuation is registered", async () => {
    await expect(
      resumeDiscordHitlSession({
        ownerUserId: "owner-1",
        discordUserId: "discord-1",
        sessionId: "missing-session",
        action: "review",
        value: null,
      }),
    ).rejects.toThrow(/No Discord HITL resume handler registered/);
  });

  it("renders Discord HITL clarification modals and review components", () => {
    expect(
      renderDiscordHitlPrompt({
        sessionId: "session-1",
        kind: "clarification",
        content: "Who did you mean?",
      }),
    ).toMatchObject({
      type: 9,
      data: {
        custom_id: "clarify:session-1",
        components: [{ components: [{ type: 4, custom_id: "clarification" }] }],
      },
    });

    expect(
      renderDiscordHitlPrompt({
        sessionId: "session-1",
        kind: "review",
        content: "Review this capture.",
      }),
    ).toMatchObject({
      type: 4,
      data: {
        content: "Review this capture.",
        components: [{ components: [{ type: 2, custom_id: "review:session-1" }] }],
      },
    });
  });

  it("keeps the live Discord request path away from forbidden durable promotion seams", async () => {
    const forbidden = {
      approveSuggestedMemory: vi.fn(),
      createActiveFollowup: vi.fn(),
      createMessageDraft: vi.fn(),
      externalAction: vi.fn(),
    };
    const body = JSON.stringify({
      type: 2,
      user: { id: "discord-1" },
      data: {
        name: "capture",
        options: [{ name: "message", type: 3, value: "Saw Maya at the conference." }],
      },
    });
    const signed = signDiscordBody(body);

    const response = await handleDiscordRequest(
      new Request("https://example.com/eve/v1/discord", {
        method: "POST",
        body,
        headers: signed.headers,
      }),
      {
        publicKey: signed.publicKeyHex,
        ownerMapRaw: "discord-1:owner-1",
        deps: { ...deps(), ...forbidden },
      },
    );

    expect(response.status).toBe(200);
    for (const fn of Object.values(forbidden)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("rejects unsigned Discord requests before owner mapping or capture", async () => {
    const captureDeps = deps();
    const response = await handleDiscordRequest(
      new Request("https://example.com/eve/v1/discord", {
        method: "POST",
        body: JSON.stringify({ type: 1 }),
      }),
      { publicKey: "00".repeat(32), deps: captureDeps },
    );

    expect(response.status).toBe(401);
    expect(captureDeps.captureGlobal).not.toHaveBeenCalled();
  });
});
