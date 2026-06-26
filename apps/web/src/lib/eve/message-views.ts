import type { EveDynamicToolPart, EveMessage, EveMessagePart } from "eve/react";
import { type AssistantToolView, toAssistantToolView } from "./tool-result-view";

function isTextPart(part: EveMessagePart): part is Extract<EveMessagePart, { type: "text" }> {
  return part.type === "text";
}

/** Only terminal `output-available` tool parts carry a persisted payload. */
function isCompletedToolPart(
  part: EveMessagePart,
): part is EveDynamicToolPart & { state: "output-available"; output: unknown } {
  return part.type === "dynamic-tool" && part.state === "output-available";
}

/** Streamed assistant text for one message, concatenated across its text parts. */
export function messageText(message: EveMessage): string {
  return message.parts
    .filter(isTextPart)
    .map((part) => part.text)
    .join("");
}

/**
 * Renderable views for an assistant message's persisted tool results. Only
 * terminal `output-available` parts on an assistant message carry a persisted
 * payload; pending, errored, denied, or non-assistant parts are skipped so the
 * UI never implies an unsaved result (ADR 0028, ADR 0029).
 */
export function messageToolViews(message: EveMessage): AssistantToolView[] {
  if (message.role !== "assistant") {
    return [];
  }

  return message.parts
    .filter(isCompletedToolPart)
    .map((part) => toAssistantToolView({ toolName: part.toolName, output: part.output }));
}
