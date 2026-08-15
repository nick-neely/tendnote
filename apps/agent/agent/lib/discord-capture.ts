import type {
  CaptureLoggedContextDeps,
  CaptureSourceRecordResult,
} from "@tendnote/db/queries/source-records";
import { captureLoggedContext } from "@tendnote/db/queries/source-records";
import type { PrivacyScope } from "@tendnote/domain";
import { resolveDiscordCaptureScope } from "./discord-capture-scope";
import type { DiscordHitlSession, DiscordHitlSessionStore } from "./discord-hitl-sessions";
import { modeAllowsTool, resolveEveMode } from "./eve-modes";

export type DiscordOwnerMap = Record<string, string>;

export type DiscordInteraction =
  | {
      type: "slash_command";
      commandName: "capture";
      discordUserId: string;
      content: string;
      personId?: string;
      attachments?: readonly DiscordAttachment[];
      /** Discord guild the command arrived from. The scope policy reads it only to ignore it. */
      guildId?: string | null;
      /** Discord channel the command arrived from. The scope policy reads it only to ignore it. */
      channelId?: string | null;
      /** An explicit visibility scope, if a future surface ever plumbs one through Discord. */
      requestedScope?: PrivacyScope;
    }
  | DiscordComponentInteraction
  | DiscordModalSubmitInteraction;

/** What a button click and its modal submit carry: the session, never the owner. */
type DiscordSessionInteraction = {
  discordUserId: string;
  sessionId: string;
  action: DiscordComponentAction;
  value?: string;
};

export type DiscordComponentInteraction = { type: "component" } & DiscordSessionInteraction;

export type DiscordModalSubmitInteraction = { type: "modal_submit" } & DiscordSessionInteraction;

export type DiscordAttachment = {
  id: string;
  filename: string;
  contentType?: string;
};

export type DiscordComponentAction = "clarify" | "review";

export type DiscordComponentCustomId = {
  action: DiscordComponentAction;
  sessionId: string;
};

export type DiscordCaptureResult =
  | {
      type: "captured";
      ownerUserId: string;
      sourceRecord: Pick<
        CaptureSourceRecordResult["sourceRecord"],
        "id" | "status" | "content" | "scope"
      >;
      linkedPersonId: string | null;
      reviewRequired: true;
      durablePromotions: [];
      components: DiscordMessageComponent[];
    }
  | {
      /** A HITL session was parked durably; the caller may now open the modal. */
      type: "hitl_prompt";
      ownerUserId: string;
      sessionId: string;
      kind: "clarification";
    }
  | {
      /** A modal submit resumed its parked session and captured the clarification. */
      type: "resumed_session";
      ownerUserId: string;
      sessionId: string;
      action: DiscordComponentAction;
      value: string;
      sourceRecord: Pick<
        CaptureSourceRecordResult["sourceRecord"],
        "id" | "status" | "content" | "scope"
      >;
      reviewRequired: true;
      durablePromotions: [];
      components: DiscordMessageComponent[];
    }
  | {
      type: "rejected";
      reason: DiscordCaptureRejectionReason;
    };

export type DiscordCaptureRejectionReason =
  | "unmapped_discord_user"
  | "unsupported_command"
  | "empty_capture"
  | "empty_clarification"
  | "attachments_not_supported"
  | "mode_forbids_capture"
  | "household_scope_not_supported"
  | "hitl_session_expired"
  | "hitl_session_unavailable";

export type DiscordMessageComponent = {
  type: "action_row";
  components: Array<{
    type: "button";
    style: "secondary";
    customId: string;
    label: string;
  }>;
};

export type DiscordCaptureDeps = CaptureLoggedContextDeps & {
  /**
   * Durable store for HITL sessions that are open but not yet submitted. It has
   * to outlive the process that opened the modal, because the submit arrives as
   * a separate request that any instance may serve.
   */
  hitlSessions: DiscordHitlSessionStore;
};

/**
 * Resolve the Tendnote owner for a Discord user id, or `null` when unmapped.
 * Resolution always fails closed: `null` rejects the interaction before any write.
 * See {@link createDiscordOwnerResolver} for the production resolution order.
 */
export type DiscordOwnerResolver = (discordUserId: string) => Promise<string | null>;

export function parseDiscordOwnerMap(raw: string | undefined): DiscordOwnerMap {
  if (!raw?.trim()) return {};

  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as DiscordOwnerMap;
  }

  return Object.fromEntries(
    trimmed
      .split(",")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const [discordUserId, ownerUserId] = pair.split(":").map((part) => part.trim());
        if (!discordUserId || !ownerUserId) {
          throw new Error(
            "Discord owner map entries must be formatted as discordUserId:ownerUserId",
          );
        }
        return [discordUserId, ownerUserId];
      }),
  );
}

/** Build a resolver from a static owner map (dev/local fallback path only). */
export function discordOwnerMapResolver(ownerMap: DiscordOwnerMap): DiscordOwnerResolver {
  return async (discordUserId) => ownerMap[discordUserId] ?? null;
}

/**
 * Compose the production resolution order: persisted owner-scoped Discord identity
 * first, then an optional dev-only fallback. Fails closed (`null`) when no source
 * maps the Discord user, so unmapped users never resolve to an owner.
 */
export function createDiscordOwnerResolver(input: {
  resolvePersistedOwner: DiscordOwnerResolver;
  devFallback?: DiscordOwnerResolver | null;
}): DiscordOwnerResolver {
  return async (discordUserId) => {
    const persisted = await input.resolvePersistedOwner(discordUserId);
    if (persisted) {
      return persisted;
    }

    return input.devFallback ? input.devFallback(discordUserId) : null;
  };
}

export async function handleDiscordCaptureInteraction(
  interaction: DiscordInteraction,
  deps: DiscordCaptureDeps,
  resolveOwner: DiscordOwnerResolver,
): Promise<DiscordCaptureResult> {
  const ownerUserId = await resolveOwner(interaction.discordUserId);
  if (!ownerUserId) {
    return { type: "rejected", reason: "unmapped_discord_user" };
  }

  if (interaction.type === "component") {
    return parkClarificationSession(interaction, deps, ownerUserId);
  }

  if (interaction.type === "modal_submit") {
    return resumeClarificationSession(interaction, deps, ownerUserId);
  }

  if (interaction.commandName !== "capture") {
    return { type: "rejected", reason: "unsupported_command" };
  }

  // Defense in depth: the channel refuses attachments while parsing, before an
  // interaction is built, so this only fires for a caller that assembled one by
  // hand. Both paths answer with the same message.
  if (interaction.attachments?.length) {
    return { type: "rejected", reason: "attachments_not_supported" };
  }

  const retainedContent = interaction.content.trim();
  if (!retainedContent) {
    return { type: "rejected", reason: "empty_capture" };
  }

  if (!discordCaptureAllowedByMode()) {
    return { type: "rejected", reason: "mode_forbids_capture" };
  }

  // Deterministic scope decision before any write: Discord capture is always
  // private owner-scoped context. Guild/channel membership never implies
  // household or shared visibility, and an explicit non-private request fails
  // closed rather than being honored (ADR-0140).
  const scopeDecision = resolveDiscordCaptureScope({
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    requestedScope: interaction.requestedScope,
  });
  if (scopeDecision.type === "rejected") {
    return { type: "rejected", reason: scopeDecision.reason };
  }

  const { sourceRecord } = await captureLoggedContext(
    {
      ownerUserId,
      retainedContent,
      personId: interaction.personId,
      captureSurface: "discord",
    },
    deps,
  );

  return {
    type: "captured",
    ownerUserId,
    sourceRecord: {
      id: sourceRecord.id,
      status: sourceRecord.status,
      content: sourceRecord.content,
      scope: sourceRecord.scope,
    },
    linkedPersonId: interaction.personId ?? null,
    reviewRequired: true,
    durablePromotions: [],
    components: reviewComponentsForSourceRecord(sourceRecord.id),
  };
}

/**
 * Clicking "Clarify" opens a modal, and Discord sends the submit as a separate
 * request that any instance may serve. The session is therefore parked durably
 * *before* the modal is rendered: an unparked modal would have nothing to
 * resume against. Only the clarification button opens one; the review button is
 * a link-out with no session.
 */
async function parkClarificationSession(
  interaction: DiscordComponentInteraction,
  deps: DiscordCaptureDeps,
  ownerUserId: string,
): Promise<DiscordCaptureResult> {
  if (interaction.action !== "clarify") {
    return { type: "rejected", reason: "unsupported_command" };
  }

  try {
    await deps.hitlSessions.park({
      ownerUserId,
      discordUserId: interaction.discordUserId,
      sessionId: interaction.sessionId,
      action: "clarify",
      parkedAt: new Date().toISOString(),
    });
  } catch (error) {
    // Same posture as the shared rate limiter: an unreachable store is a
    // controlled refusal the user can act on, never a thrown request.
    console.error("Discord HITL session park failed.", error);
    return { type: "rejected", reason: "hitl_session_unavailable" };
  }

  return {
    type: "hitl_prompt",
    ownerUserId,
    sessionId: interaction.sessionId,
    kind: "clarification",
  };
}

/**
 * A modal submit resumes its parked session and completes it: the clarification
 * becomes owner-scoped logged context for review, carrying the session id so the
 * clarification stays attached to what it clarifies. It stays inside the Discord
 * capture boundary: a Source Record for review, never a durable promotion.
 *
 * Taking the session consumes it, so a resubmitted modal cannot capture twice.
 */
async function resumeClarificationSession(
  interaction: DiscordModalSubmitInteraction,
  deps: DiscordCaptureDeps,
  ownerUserId: string,
): Promise<DiscordCaptureResult> {
  const clarification = interaction.value?.trim();
  if (!clarification) {
    return { type: "rejected", reason: "empty_clarification" };
  }

  if (!discordCaptureAllowedByMode()) {
    return { type: "rejected", reason: "mode_forbids_capture" };
  }

  let parked: DiscordHitlSession | null;
  try {
    parked = await deps.hitlSessions.take({ ownerUserId, sessionId: interaction.sessionId });
  } catch (error) {
    console.error("Discord HITL session resume failed.", error);
    return { type: "rejected", reason: "hitl_session_unavailable" };
  }

  // No parked session means it expired, was already resumed, or was opened by a
  // different owner: nothing to resume, and nothing is written.
  if (!parked) {
    return { type: "rejected", reason: "hitl_session_expired" };
  }

  const { sourceRecord } = await captureLoggedContext(
    {
      ownerUserId,
      retainedContent: clarification,
      captureSurface: "discord",
      metadataJson: { discordHitlSessionId: parked.sessionId },
    },
    deps,
  );

  return {
    type: "resumed_session",
    ownerUserId,
    sessionId: parked.sessionId,
    action: parked.action,
    value: clarification,
    sourceRecord: {
      id: sourceRecord.id,
      status: sourceRecord.status,
      content: sourceRecord.content,
      scope: sourceRecord.scope,
    },
    reviewRequired: true,
    durablePromotions: [],
    components: reviewComponentsForSourceRecord(sourceRecord.id),
  };
}

/** Discord Capture Mode has to allow a Source Record write for either capture path. */
function discordCaptureAllowedByMode(): boolean {
  const mode = resolveEveMode({ caller: "discord", channel: "discord", requestedTask: "capture" });
  return modeAllowsTool(mode.mode, "capture_source_record");
}

function reviewComponentsForSourceRecord(sourceRecordId: string): DiscordMessageComponent[] {
  return discordReviewComponents(sourceRecordId);
}

export function discordReviewComponents(sessionId: string): DiscordMessageComponent[] {
  return [
    {
      type: "action_row",
      components: [
        {
          type: "button",
          style: "secondary",
          customId: encodeDiscordComponentCustomId({ action: "review", sessionId }),
          label: "Review in Tendnote",
        },
      ],
    },
  ];
}

export function discordClarificationComponents(sessionId: string): DiscordMessageComponent[] {
  return [
    {
      type: "action_row",
      components: [
        {
          type: "button",
          style: "secondary",
          customId: encodeDiscordComponentCustomId({ action: "clarify", sessionId }),
          label: "Clarify",
        },
      ],
    },
  ];
}

export function discordClarificationModal(sessionId: string): {
  title: string;
  customId: string;
  components: Array<{
    type: "action_row";
    components: Array<{
      type: "text_input";
      customId: string;
      label: string;
      style: "paragraph";
      required: true;
    }>;
  }>;
} {
  return {
    title: "Clarify Tendnote capture",
    customId: encodeDiscordComponentCustomId({ action: "clarify", sessionId }),
    components: [
      {
        type: "action_row",
        components: [
          {
            type: "text_input",
            customId: "clarification",
            label: "What should Eve know?",
            style: "paragraph",
            required: true,
          },
        ],
      },
    ],
  };
}

export function encodeDiscordComponentCustomId(input: DiscordComponentCustomId): string {
  return `${input.action}:${input.sessionId}`;
}

export function decodeDiscordComponentCustomId(value: string): DiscordComponentCustomId | null {
  const separator = value.indexOf(":");
  if (separator <= 0) return null;

  const action = value.slice(0, separator);
  const sessionId = value.slice(separator + 1);
  if ((action !== "clarify" && action !== "review") || !sessionId) return null;

  return { action, sessionId };
}
