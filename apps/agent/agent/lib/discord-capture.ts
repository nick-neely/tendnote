import type {
  CaptureLoggedContextDeps,
  CaptureSourceRecordResult,
} from "@tendnote/db/queries/source-records";
import { captureLoggedContext } from "@tendnote/db/queries/source-records";
import type { PrivacyScope } from "@tendnote/domain";
import { resolveDiscordCaptureScope } from "./discord-capture-scope";
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
  | {
      type: "component" | "modal_submit";
      discordUserId: string;
      sessionId: string;
      action: "clarify" | "review";
      value?: string;
    };

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
      type: "parked_session";
      ownerUserId: string;
      sessionId: string;
      action: DiscordComponentAction;
      value: string | null;
    }
  | {
      type: "rejected";
      reason:
        | "unmapped_discord_user"
        | "unsupported_command"
        | "empty_capture"
        | "attachments_not_supported"
        | "mode_forbids_capture"
        | "household_scope_not_supported";
    };

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
  parkHitlSession: (input: DiscordHitlSessionInput) => Promise<unknown>;
  resumeHitlSession: (input: DiscordHitlSessionInput) => Promise<unknown>;
};

export type DiscordHitlSessionInput = {
  ownerUserId: string;
  discordUserId: string;
  sessionId: string;
  action: DiscordComponentAction;
  value: string | null;
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

  if (interaction.type === "component" || interaction.type === "modal_submit") {
    const value = interaction.value?.trim() || null;
    const sessionInput = {
      ownerUserId,
      discordUserId: interaction.discordUserId,
      sessionId: interaction.sessionId,
      action: interaction.action,
      value,
    };
    await deps.parkHitlSession(sessionInput);
    await deps.resumeHitlSession(sessionInput);

    return {
      type: "parked_session",
      ownerUserId,
      sessionId: interaction.sessionId,
      action: interaction.action,
      value,
    };
  }

  if (interaction.type !== "slash_command" || interaction.commandName !== "capture") {
    return { type: "rejected", reason: "unsupported_command" };
  }

  if (interaction.attachments?.length) {
    return { type: "rejected", reason: "attachments_not_supported" };
  }

  const retainedContent = interaction.content.trim();
  if (!retainedContent) {
    return { type: "rejected", reason: "empty_capture" };
  }

  const mode = resolveEveMode({ caller: "discord", channel: "discord", requestedTask: "capture" });
  if (!modeAllowsTool(mode.mode, "capture_source_record")) {
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
