import { createPublicKey, verify } from "node:crypto";
import { resolveDiscordIdentityOwner } from "@tendnote/db/queries/discord-identities";
import { captureSourceRecord } from "@tendnote/db/queries/source-records";
import { defineChannel, POST } from "eve/channels";
import { captureSourceRecordForPersonWithEmbeddingDelivery } from "../lib/background-jobs/embedding-schedulers";
import { enqueueAndPublishExtractionJob } from "../lib/background-jobs/extraction-queue";
import {
  createDiscordOwnerResolver,
  type DiscordCaptureDeps,
  type DiscordHitlSessionInput,
  type DiscordInteraction,
  type DiscordMessageComponent,
  type DiscordOwnerResolver,
  decodeDiscordComponentCustomId,
  discordClarificationModal,
  discordOwnerMapResolver,
  discordReviewComponents,
  handleDiscordCaptureInteraction,
  parseDiscordOwnerMap,
} from "../lib/discord-capture";

const DISCORD_SIGNATURE_HEADER = "x-signature-ed25519";
const DISCORD_TIMESTAMP_HEADER = "x-signature-timestamp";

type DiscordApiInteraction = {
  type: number;
  data?: {
    name?: string;
    custom_id?: string;
    components?: Array<{ components?: Array<{ custom_id?: string; value?: string }> }>;
    resolved?: { attachments?: Record<string, unknown> };
    options?: Array<{ name: string; type: number; value?: string }>;
  };
  guild_id?: string;
  channel_id?: string;
  member?: { user?: { id?: string } };
  user?: { id?: string };
};

type DiscordInteractionResponse = {
  type: 1 | 4 | 9;
  data?: {
    content?: string;
    flags?: 64;
    title?: string;
    custom_id?: string;
    components?: Array<{
      type: 1;
      components: Array<
        | { type: 2; style: 2; custom_id: string; label: string }
        | { type: 4; custom_id: string; label: string; style: 2; required: true }
      >;
    }>;
  };
};

export function createDiscordProactiveDeliverySender(
  input: { botToken?: string; fetch?: typeof fetch } = {},
) {
  const botToken = input.botToken ?? process.env.DISCORD_BOT_TOKEN;
  const fetchImpl = input.fetch ?? fetch;

  if (!botToken) {
    return null;
  }

  return async ({ targetId, content }: { targetId: string; content: string }) => {
    const response = await fetchImpl(
      `https://discord.com/api/v10/channels/${encodeURIComponent(targetId)}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bot ${botToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ content }),
      },
    );

    if (!response.ok) {
      throw new Error(`Discord proactive delivery failed with status ${response.status}`);
    }
  };
}

export async function handleDiscordRequest(
  request: Request,
  input: {
    publicKey?: string;
    resolveOwner?: DiscordOwnerResolver;
    ownerMapRaw?: string;
    deps?: DiscordCaptureDeps;
  } = {},
): Promise<Response> {
  const body = await request.text();
  const publicKey = input.publicKey ?? process.env.DISCORD_PUBLIC_KEY;

  if (!publicKey || !verifyDiscordSignature(request.headers, body, publicKey)) {
    return json({ error: "invalid Discord signature" }, 401);
  }

  const payload = parseDiscordApiInteraction(body);
  if (!payload) {
    return json({ error: "invalid Discord interaction payload" }, 400);
  }

  if (payload.type === 1) {
    return json({ type: 1 } satisfies DiscordInteractionResponse);
  }

  const interaction = discordApiPayloadToCaptureInteraction(payload);
  if (!interaction) {
    return json(ephemeral("Unsupported Discord interaction."), 200);
  }

  if (interaction.type === "component" && interaction.action === "clarify") {
    return json(
      renderDiscordHitlPrompt({
        sessionId: interaction.sessionId,
        kind: "clarification",
        content: "What should Eve know?",
      }),
    );
  }

  if (interaction.type === "component" && interaction.action === "review") {
    return json(ephemeral(`Open Tendnote to review Source Record ${interaction.sessionId}.`), 200);
  }

  const result = await handleDiscordCaptureInteraction(
    interaction,
    input.deps ?? defaultDiscordCaptureDeps(),
    createDiscordRequestOwnerResolver(input),
  );

  if (result.type === "captured") {
    return json({
      type: 4,
      data: {
        content: "Captured as Tendnote logged context for review.",
        flags: 64,
        components: discordComponentsToApi(result.components),
      },
    } satisfies DiscordInteractionResponse);
  }

  if (result.type === "parked_session") {
    return json(ephemeral("Saved that clarification for the Tendnote review session."), 200);
  }

  return json(ephemeral(responseForRejection(result.reason)), 200);
}

export default defineChannel({
  routes: [POST("/", (request) => handleDiscordRequest(request))],
});

export function renderDiscordHitlPrompt(input: {
  sessionId: string;
  kind: "clarification" | "review";
  content: string;
}): DiscordInteractionResponse {
  if (input.kind === "clarification") {
    const modal = discordClarificationModal(input.sessionId);

    return {
      type: 9,
      data: {
        title: modal.title,
        custom_id: modal.customId,
        components: modal.components.map((row) => ({
          type: 1,
          components: row.components.map((component) => ({
            type: 4,
            custom_id: component.customId,
            label: component.label,
            style: 2,
            required: true,
          })),
        })),
      },
    };
  }

  return {
    type: 4,
    data: {
      content: input.content,
      flags: 64,
      components: discordComponentsToApi(discordReviewComponents(input.sessionId)),
    },
  };
}

export function verifyDiscordSignature(
  headers: Headers,
  body: string,
  publicKeyHex: string,
): boolean {
  const signature = headers.get(DISCORD_SIGNATURE_HEADER);
  const timestamp = headers.get(DISCORD_TIMESTAMP_HEADER);
  if (!signature || !timestamp) return false;

  try {
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const key = createPublicKey({
      key: Buffer.concat([spkiPrefix, Buffer.from(publicKeyHex, "hex")]),
      format: "der",
      type: "spki",
    });

    return verify(null, Buffer.from(`${timestamp}${body}`), key, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

export function discordApiPayloadToCaptureInteraction(
  payload: DiscordApiInteraction,
): DiscordInteraction | null {
  const discordUserId = payload.member?.user?.id ?? payload.user?.id;
  if (!discordUserId) return null;

  if (payload.type === 2 && payload.data?.name === "capture") {
    return {
      type: "slash_command",
      commandName: "capture",
      discordUserId,
      content: slashOption(payload, "message") ?? "",
      // The scope policy reads these but never widens scope from them; nothing persists them.
      guildId: payload.guild_id ?? null,
      channelId: payload.channel_id ?? null,
      attachments: payload.data.resolved?.attachments
        ? Object.entries(payload.data.resolved.attachments).map(([id, value]) => ({
            id,
            filename:
              typeof value === "object" &&
              value !== null &&
              "filename" in value &&
              typeof value.filename === "string"
                ? value.filename
                : "attachment",
          }))
        : undefined,
    };
  }

  if (payload.type === 3 || payload.type === 5) {
    const customId = payload.data?.custom_id ?? firstSubmittedComponentId(payload);
    if (!customId) return null;
    const decoded = decodeDiscordComponentCustomId(customId);
    if (!decoded) return null;

    return {
      type: payload.type === 3 ? "component" : "modal_submit",
      discordUserId,
      sessionId: decoded.sessionId,
      action: decoded.action,
      value: firstSubmittedValue(payload),
    };
  }

  return null;
}

function parseDiscordApiInteraction(body: string): DiscordApiInteraction | null {
  try {
    return JSON.parse(body) as DiscordApiInteraction;
  } catch {
    return null;
  }
}

/**
 * Owner resolution for a Discord request. An explicitly injected `resolveOwner`
 * wins (tests, custom wiring). Otherwise resolution is always persisted-identity
 * first, with the `DISCORD_OWNER_USER_MAP` env map (or an explicit `ownerMapRaw`)
 * applied only as a lower-priority, dev-only fallback — never in production and
 * never ahead of persisted identity. Unmapped Discord users fail closed.
 *
 * `resolvePersistedOwner` and `nodeEnv` are test seams; production passes neither.
 */
export function createDiscordRequestOwnerResolver(
  input: {
    resolveOwner?: DiscordOwnerResolver;
    ownerMapRaw?: string;
    resolvePersistedOwner?: DiscordOwnerResolver;
    nodeEnv?: string;
  } = {},
): DiscordOwnerResolver {
  if (input.resolveOwner) {
    return input.resolveOwner;
  }

  const resolvePersistedOwner =
    input.resolvePersistedOwner ??
    ((discordUserId: string) => resolveDiscordIdentityOwner({ discordUserId }));

  return createDiscordOwnerResolver({
    resolvePersistedOwner,
    devFallback: isDiscordOwnerMapFallbackAllowed(input.nodeEnv)
      ? discordOwnerMapResolver(
          parseDiscordOwnerMap(input.ownerMapRaw ?? process.env.DISCORD_OWNER_USER_MAP),
        )
      : null,
  });
}

/** The env owner map is a dev-only fallback; see `docs/discord-setup.md` §5. */
export function isDiscordOwnerMapFallbackAllowed(nodeEnv = process.env.NODE_ENV): boolean {
  return nodeEnv !== "production";
}

function defaultDiscordCaptureDeps(): DiscordCaptureDeps {
  return {
    captureForPerson: captureSourceRecordForPersonWithEmbeddingDelivery,
    captureGlobal: captureSourceRecord,
    enqueueExtraction: enqueueAndPublishExtractionJob,
    parkHitlSession: parkDiscordHitlSession,
    resumeHitlSession: resumeDiscordHitlSession,
  };
}

type DiscordHitlSession = DiscordHitlSessionInput & {
  handledAt: Date;
};

type ParkedDiscordHitlSession = {
  ownerUserId: string;
  discordUserId: string;
  sessionId: string;
  action: "clarify" | "review";
  value: string | null;
  parkedAt: Date;
};

const parkedDiscordHitlSessions = new Map<string, ParkedDiscordHitlSession>();
const resumedDiscordHitlSessions = new Map<string, DiscordHitlSession>();
const discordHitlResumeHandlers = new Map<
  string,
  (input: DiscordHitlSessionInput) => Promise<unknown>
>();

export async function parkDiscordHitlSession(
  input: Omit<ParkedDiscordHitlSession, "parkedAt">,
): Promise<ParkedDiscordHitlSession> {
  const parked = { ...input, parkedAt: new Date() };
  parkedDiscordHitlSessions.set(input.sessionId, parked);
  return parked;
}

export function getParkedDiscordHitlSession(sessionId: string): ParkedDiscordHitlSession | null {
  return parkedDiscordHitlSessions.get(sessionId) ?? null;
}

export async function resumeDiscordHitlSession(
  input: DiscordHitlSessionInput,
): Promise<DiscordHitlSession> {
  const resumeHandler = discordHitlResumeHandlers.get(input.sessionId);
  if (!resumeHandler) {
    throw new Error(`No Discord HITL resume handler registered for session ${input.sessionId}`);
  }

  await resumeHandler(input);
  const resumed = { ...input, handledAt: new Date() };
  resumedDiscordHitlSessions.set(input.sessionId, resumed);
  return resumed;
}

export function getResumedDiscordHitlSession(sessionId: string): DiscordHitlSession | null {
  return resumedDiscordHitlSessions.get(sessionId) ?? null;
}

export function registerDiscordHitlSessionResumeHandler(
  sessionId: string,
  handler: (input: DiscordHitlSessionInput) => Promise<unknown>,
): () => void {
  discordHitlResumeHandlers.set(sessionId, handler);
  return () => {
    discordHitlResumeHandlers.delete(sessionId);
  };
}

function slashOption(payload: DiscordApiInteraction, name: string): string | null {
  const value = payload.data?.options?.find((option) => option.name === name)?.value;
  return typeof value === "string" ? value : null;
}

function firstSubmittedComponentId(payload: DiscordApiInteraction): string | undefined {
  return payload.data?.components?.flatMap((row) => row.components ?? [])[0]?.custom_id;
}

function firstSubmittedValue(payload: DiscordApiInteraction): string | undefined {
  return payload.data?.components?.flatMap((row) => row.components ?? [])[0]?.value;
}

function responseForRejection(reason: string): string {
  switch (reason) {
    case "unmapped_discord_user":
      return "This Discord user is not mapped to a Tendnote owner.";
    case "attachments_not_supported":
      return "Discord attachments are not a Tendnote cleanup import path yet.";
    case "empty_capture":
      return "Add text to capture with the command.";
    case "household_scope_not_supported":
      return "Discord capture is private to you. Household or shared visibility is set in Tendnote, not from Discord.";
    default:
      return "Tendnote could not capture that Discord interaction.";
  }
}

function ephemeral(content: string): DiscordInteractionResponse {
  return { type: 4, data: { content, flags: 64 } };
}

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, { status });
}

function discordComponentsToApi(components: DiscordMessageComponent[]) {
  return components.map((row) => ({
    type: 1 as const,
    components: row.components.map((component) => ({
      type: 2 as const,
      style: 2 as const,
      custom_id: component.customId,
      label: component.label,
    })),
  }));
}
