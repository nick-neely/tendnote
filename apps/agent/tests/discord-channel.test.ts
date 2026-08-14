import { generateKeyPairSync, sign } from "node:crypto";
import type { SourceRecord } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import discordChannel, {
  createDiscordRequestOwnerResolver,
  discordApiPayloadToCaptureInteraction,
  handleDiscordRequest,
  isDiscordOwnerMapFallbackAllowed,
  renderDiscordHitlPrompt,
  verifyDiscordSignature,
} from "../agent/channels/discord";
import {
  type DiscordCaptureDeps,
  type DiscordOwnerResolver,
  discordOwnerMapResolver,
} from "../agent/lib/discord-capture";
import {
  createInMemoryDiscordHitlSessionStore,
  type DiscordHitlSession,
  type DiscordHitlSessionStore,
} from "../agent/lib/discord-hitl-sessions";

const ownerResolver: DiscordOwnerResolver = discordOwnerMapResolver({
  "discord-1": "owner-1",
  "discord-2": "owner-2",
});

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

/** The real in-memory HITL store with call recording, so parking is observable. */
function hitlSessionStore(
  store: DiscordHitlSessionStore = createInMemoryDiscordHitlSessionStore(),
) {
  return {
    park: vi.fn((session: DiscordHitlSession) => store.park(session)),
    take: vi.fn((input: { ownerUserId: string; sessionId: string }) => store.take(input)),
  };
}

function deps(hitlSessions = hitlSessionStore()) {
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
    enqueueActionExtraction: vi.fn(async () => undefined),
    hitlSessions,
  } satisfies DiscordCaptureDeps;
}

/** Sign `body` and POST it through `handler` (the live channel export by default). */
async function postSignedInteraction(
  body: string,
  options: {
    captureDeps?: ReturnType<typeof deps>;
    handler?: typeof handleDiscordRequest;
  } = {},
) {
  const signed = signDiscordBody(body);
  const captureDeps = options.captureDeps ?? deps();

  const response = await (options.handler ?? handleDiscordRequest)(
    new Request("https://example.com/eve/v1/discord", {
      method: "POST",
      body,
      headers: signed.headers,
    }),
    { publicKey: signed.publicKeyHex, resolveOwner: ownerResolver, deps: captureDeps },
  );

  return { response, captureDeps };
}

function clarifyButtonBody(discordUserId = "discord-1", sessionId = "session-1") {
  return JSON.stringify({
    type: 3,
    user: { id: discordUserId },
    data: { custom_id: `clarify:${sessionId}` },
  });
}

function clarifyModalSubmitBody(
  discordUserId = "discord-1",
  sessionId = "session-1",
  value = "I meant Sam Lee.",
) {
  return JSON.stringify({
    type: 5,
    user: { id: discordUserId },
    data: {
      custom_id: `clarify:${sessionId}`,
      components: [{ components: [{ custom_id: "clarification", value }] }],
    },
  });
}

describe("Discord interaction channel", () => {
  it("registers the public Discord interactions endpoint", () => {
    expect(discordChannel.routes.map(({ method, path }) => ({ method, path }))).toContainEqual({
      method: "POST",
      path: "/eve/v1/discord",
    });
  });

  it("verifies Discord Ed25519 request signatures", () => {
    const body = JSON.stringify({ type: 1 });
    const signed = signDiscordBody(body);

    expect(verifyDiscordSignature(signed.headers, body, signed.publicKeyHex)).toBe(true);
    expect(verifyDiscordSignature(signed.headers, `${body} `, signed.publicKeyHex)).toBe(false);
  });

  it("parses slash commands and components, and rejects attachments while parsing", () => {
    expect(
      discordApiPayloadToCaptureInteraction({
        type: 2,
        guild_id: "guild-1",
        channel_id: "channel-1",
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
      guildId: "guild-1",
      channelId: "channel-1",
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

    // Attachments never become an interaction at all: no id or filename is
    // carried past the parse, and the rejection is the flow's existing message.
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
    ).toEqual({ type: "rejected", reason: "attachments_not_supported" });
  });

  it("answers an attached /capture with the attachment rejection, capturing nothing", async () => {
    const body = JSON.stringify({
      type: 2,
      member: { user: { id: "discord-1" } },
      data: {
        name: "capture",
        options: [{ name: "message", type: 3, value: "Import this" }],
        resolved: { attachments: { "file-1": { filename: "contacts.csv" } } },
      },
    });
    const { response, captureDeps } = await postSignedInteraction(body);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      type: 4,
      data: {
        content: "Discord attachments are not a Tendnote cleanup import path yet.",
        flags: 64,
      },
    });
    expect(captureDeps.captureGlobal).not.toHaveBeenCalled();
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
    const { response, captureDeps } = await postSignedInteraction(body);

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

  it("captures owner-scoped context for a signed slash command sent from a guild channel", async () => {
    const body = JSON.stringify({
      type: 2,
      guild_id: "guild-shared",
      channel_id: "channel-shared",
      member: { user: { id: "discord-1" } },
      data: {
        name: "capture",
        options: [{ name: "message", type: 3, value: "Guild-sent private note." }],
      },
    });
    const { response, captureDeps } = await postSignedInteraction(body);

    expect(response.status).toBe(200);
    // Guild/channel membership never widens scope: the capture is still the
    // caller's own owner-scoped private context.
    expect(captureDeps.captureGlobal).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "owner-1" }),
    );
  });

  it("returns a controlled error for signed malformed JSON", async () => {
    const body = "{";
    const { response, captureDeps } = await postSignedInteraction(body);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid Discord interaction payload",
    });
    expect(captureDeps.captureGlobal).not.toHaveBeenCalled();
  });

  it("parks the session durably before opening a signed clarification modal", async () => {
    const { response, captureDeps } = await postSignedInteraction(clarifyButtonBody());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      type: 9,
      data: {
        custom_id: "clarify:session-1",
        components: [{ components: [{ type: 4, custom_id: "clarification" }] }],
      },
    });
    // The modal is only shown once the submit it invites has something to
    // resume against, and the parked session holds no clarification text.
    expect(captureDeps.hitlSessions.park).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      discordUserId: "discord-1",
      sessionId: "session-1",
      action: "clarify",
      parkedAt: expect.any(String),
    });
    expect(captureDeps.captureGlobal).not.toHaveBeenCalled();
  });

  it("acknowledges review buttons without treating source records as HITL sessions", async () => {
    const body = JSON.stringify({
      type: 3,
      user: { id: "discord-1" },
      data: { custom_id: "review:source-global" },
    });
    const { response, captureDeps } = await postSignedInteraction(body);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      type: 4,
      data: {
        content: "Open Tendnote to review Source Record source-global.",
        flags: 64,
      },
    });
    expect(captureDeps.hitlSessions.park).not.toHaveBeenCalled();
    expect(captureDeps.hitlSessions.take).not.toHaveBeenCalled();
    expect(captureDeps.captureGlobal).not.toHaveBeenCalled();
  });

  it("resumes a signed modal submit into owner-scoped logged context for review", async () => {
    const captureDeps = deps();

    await postSignedInteraction(clarifyButtonBody(), { captureDeps });
    const { response } = await postSignedInteraction(clarifyModalSubmitBody(), { captureDeps });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      type: 4,
      data: {
        content: "Saved that clarification as Tendnote logged context for review.",
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
    // The clarification is a real capture now, carrying the session it clarifies.
    expect(captureDeps.captureGlobal).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        retainedContent: "I meant Sam Lee.",
        metadataJson: { captureSurface: "discord", discordHitlSessionId: "session-1" },
      }),
    );
  });

  it("resumes a modal parked by an instance that no longer exists", async () => {
    // One shared store standing in for Redis; the module state around it is
    // thrown away between the two requests, exactly as a recycled serverless
    // instance would. Nothing about the resume may depend on process memory.
    const store = createInMemoryDiscordHitlSessionStore();
    await postSignedInteraction(clarifyButtonBody(), {
      captureDeps: deps(hitlSessionStore(store)),
    });

    vi.resetModules();
    const restarted = await import("../agent/channels/discord");
    const resumeDeps = deps(hitlSessionStore(store));
    const { response } = await postSignedInteraction(clarifyModalSubmitBody(), {
      captureDeps: resumeDeps,
      handler: restarted.handleDiscordRequest,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      type: 4,
      data: { content: "Saved that clarification as Tendnote logged context for review." },
    });
    expect(resumeDeps.captureGlobal).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "owner-1", retainedContent: "I meant Sam Lee." }),
    );
  });

  it("refuses a modal submit whose session expired, was replayed, or belongs to another owner", async () => {
    const store = createInMemoryDiscordHitlSessionStore();
    const expired = "That clarification prompt expired. Open Clarify again to send it.";

    // Never parked.
    const unparked = await postSignedInteraction(clarifyModalSubmitBody(), {
      captureDeps: deps(hitlSessionStore(store)),
    });
    await expect(unparked.response.json()).resolves.toEqual({
      type: 4,
      data: { content: expired, flags: 64 },
    });
    expect(unparked.captureDeps.captureGlobal).not.toHaveBeenCalled();

    // Parked by owner-1, submitted by another mapped Discord user: the parked
    // session is owner-scoped, so it is not theirs to resume.
    await postSignedInteraction(clarifyButtonBody(), {
      captureDeps: deps(hitlSessionStore(store)),
    });
    const otherOwner = await postSignedInteraction(clarifyModalSubmitBody("discord-2"), {
      captureDeps: deps(hitlSessionStore(store)),
    });
    await expect(otherOwner.response.json()).resolves.toEqual({
      type: 4,
      data: { content: expired, flags: 64 },
    });
    expect(otherOwner.captureDeps.captureGlobal).not.toHaveBeenCalled();

    // The owner's own submit still works, and consuming the session makes a
    // replayed submit capture nothing a second time.
    const first = await postSignedInteraction(clarifyModalSubmitBody(), {
      captureDeps: deps(hitlSessionStore(store)),
    });
    expect(first.captureDeps.captureGlobal).toHaveBeenCalledOnce();
    const replay = await postSignedInteraction(clarifyModalSubmitBody(), {
      captureDeps: deps(hitlSessionStore(store)),
    });
    await expect(replay.response.json()).resolves.toEqual({
      type: 4,
      data: { content: expired, flags: 64 },
    });
    expect(replay.captureDeps.captureGlobal).not.toHaveBeenCalled();
  });

  it("degrades to an ephemeral message when the session store is unreachable", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const unreachable = {
      park: vi.fn(async () => {
        throw new Error("connection refused");
      }),
      take: vi.fn(async () => {
        throw new Error("connection refused");
      }),
    };

    const opened = await postSignedInteraction(clarifyButtonBody(), {
      captureDeps: deps(unreachable),
    });
    const submitted = await postSignedInteraction(clarifyModalSubmitBody(), {
      captureDeps: deps(unreachable),
    });

    const unavailable = {
      type: 4,
      data: {
        content: "Tendnote could not reach its clarification store. Try that again in a moment.",
        flags: 64,
      },
    };
    expect(opened.response.status).toBe(200);
    await expect(opened.response.json()).resolves.toEqual(unavailable);
    expect(submitted.response.status).toBe(200);
    await expect(submitted.response.json()).resolves.toEqual(unavailable);
    expect(submitted.captureDeps.captureGlobal).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("answers an unexpected failure with an ephemeral message instead of a 500", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const captureDeps = deps();
    captureDeps.captureGlobal.mockRejectedValueOnce(new Error("capture store is down"));

    const { response } = await postSignedInteraction(
      JSON.stringify({
        type: 2,
        member: { user: { id: "discord-1" } },
        data: {
          name: "capture",
          options: [{ name: "message", type: 3, value: "Lunch with Sam" }],
        },
      }),
      { captureDeps },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      type: 4,
      data: {
        content: "Tendnote could not complete that Discord interaction. Try again in a moment.",
        flags: 64,
      },
    });
    logged.mockRestore();
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
        resolveOwner: ownerResolver,
        deps: { ...deps(), ...forbidden },
      },
    );

    expect(response.status).toBe(200);
    for (const fn of Object.values(forbidden)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("resolves owners from an injected persisted resolver, isolating two guild users", async () => {
    const persistedOwners: Record<string, string> = {
      "discord-1": "owner-1",
      "discord-2": "owner-2",
    };
    const resolveOwner = vi.fn(
      async (discordUserId: string) => persistedOwners[discordUserId] ?? null,
    );

    async function captureFor(discordUserId: string, captureDeps: DiscordCaptureDeps) {
      const body = JSON.stringify({
        type: 2,
        member: { user: { id: discordUserId } },
        data: {
          name: "capture",
          options: [{ name: "message", type: 3, value: "Context." }],
        },
      });
      const signed = signDiscordBody(body);

      return handleDiscordRequest(
        new Request("https://example.com/eve/v1/discord", {
          method: "POST",
          body,
          headers: signed.headers,
        }),
        { publicKey: signed.publicKeyHex, resolveOwner, deps: captureDeps },
      );
    }

    const depsOne = deps();
    const depsTwo = deps();
    await captureFor("discord-1", depsOne);
    await captureFor("discord-2", depsTwo);

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

  it("rejects an unmapped Discord user without writing relationship context", async () => {
    const resolveOwner = vi.fn(async () => null);
    const captureDeps = deps();
    const body = JSON.stringify({
      type: 2,
      member: { user: { id: "unmapped" } },
      data: {
        name: "capture",
        options: [{ name: "message", type: 3, value: "Should not persist." }],
      },
    });
    const signed = signDiscordBody(body);

    const response = await handleDiscordRequest(
      new Request("https://example.com/eve/v1/discord", {
        method: "POST",
        body,
        headers: signed.headers,
      }),
      { publicKey: signed.publicKeyHex, resolveOwner, deps: captureDeps },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      type: 4,
      data: {
        content: "This Discord user is not mapped to a Tendnote owner.",
        flags: 64,
      },
    });
    expect(resolveOwner).toHaveBeenCalledWith("unmapped");
    expect(captureDeps.captureGlobal).not.toHaveBeenCalled();
    expect(captureDeps.captureForPerson).not.toHaveBeenCalled();
    expect(captureDeps.enqueueExtraction).not.toHaveBeenCalled();
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

describe("Default Discord owner resolution (persisted-first, dev-only env fallback)", () => {
  it("gates the env-map fallback on NODE_ENV !== production", () => {
    expect(isDiscordOwnerMapFallbackAllowed("development")).toBe(true);
    expect(isDiscordOwnerMapFallbackAllowed("test")).toBe(true);
    expect(isDiscordOwnerMapFallbackAllowed("production")).toBe(false);
  });

  it("always resolves persisted identity ahead of the env map", async () => {
    const resolvePersistedOwner: DiscordOwnerResolver = async (discordUserId) =>
      discordUserId === "discord-1" ? "persisted-owner" : null;

    const resolve = createDiscordRequestOwnerResolver({
      resolvePersistedOwner,
      ownerMapRaw: "discord-1:env-owner",
      nodeEnv: "development",
    });

    // Persisted wins even though the env map also maps discord-1.
    await expect(resolve("discord-1")).resolves.toBe("persisted-owner");
  });

  it("uses the env map only in non-production and only when persisted is absent", async () => {
    const resolvePersistedOwner: DiscordOwnerResolver = async () => null;

    const devResolve = createDiscordRequestOwnerResolver({
      resolvePersistedOwner,
      ownerMapRaw: "discord-2:env-owner",
      nodeEnv: "development",
    });
    await expect(devResolve("discord-2")).resolves.toBe("env-owner");

    // In production the env map must not resolve — fail closed.
    const prodResolve = createDiscordRequestOwnerResolver({
      resolvePersistedOwner,
      ownerMapRaw: "discord-2:env-owner",
      nodeEnv: "production",
    });
    await expect(prodResolve("discord-2")).resolves.toBeNull();
  });

  it("fails closed in production when there is no persisted identity", async () => {
    const resolve = createDiscordRequestOwnerResolver({
      resolvePersistedOwner: async () => null,
      ownerMapRaw: "discord-1:env-owner",
      nodeEnv: "production",
    });

    await expect(resolve("discord-1")).resolves.toBeNull();
  });

  it("prefers an explicitly injected resolveOwner over persisted and env sources", async () => {
    const resolve = createDiscordRequestOwnerResolver({
      resolveOwner: async () => "injected-owner",
      resolvePersistedOwner: async () => "persisted-owner",
      ownerMapRaw: "discord-1:env-owner",
      nodeEnv: "development",
    });

    await expect(resolve("discord-1")).resolves.toBe("injected-owner");
  });
});
