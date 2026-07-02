import type {
  CaptureLoggedContextDeps,
  CaptureSourceRecordResult,
} from "@tendnote/db/queries/source-records";
import { captureLoggedContext } from "@tendnote/db/queries/source-records";
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
      sourceRecord: Pick<CaptureSourceRecordResult["sourceRecord"], "id" | "status" | "content">;
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
        | "mode_forbids_capture";
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

export function resolveDiscordOwnerUserId(
  discordUserId: string,
  ownerMap: DiscordOwnerMap = parseDiscordOwnerMap(process.env.DISCORD_OWNER_USER_MAP),
): string | null {
  return ownerMap[discordUserId] ?? null;
}

export async function handleDiscordCaptureInteraction(
  interaction: DiscordInteraction,
  deps: DiscordCaptureDeps,
  ownerMap?: DiscordOwnerMap,
): Promise<DiscordCaptureResult> {
  const ownerUserId = resolveDiscordOwnerUserId(interaction.discordUserId, ownerMap);
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
    },
    linkedPersonId: interaction.personId ?? null,
    reviewRequired: true,
    durablePromotions: [],
    components: reviewComponentsForSourceRecord(sourceRecord.id),
  };
}

export function reviewComponentsForSourceRecord(sourceRecordId: string): DiscordMessageComponent[] {
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
