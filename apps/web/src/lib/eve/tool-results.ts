import type { EveMessageData } from "eve/client";
import type { WebChatToolResult } from "./bridge";

/**
 * Collects persisted tool results from a reduced Eve turn so the web UI can
 * render the records Eve saved or found. Only terminal `output-available` tool
 * parts on assistant messages carry a persisted payload; pending, errored, or
 * denied calls are skipped so the UI never implies an unsaved result.
 *
 * This is the response-shaping half of the bridge seam (ADR 0059: test the
 * deterministic path), kept free of the eve runtime transport so it stays unit
 * testable.
 */
export function collectToolResults(data: EveMessageData): WebChatToolResult[] {
  const toolResults: WebChatToolResult[] = [];

  for (const message of data.messages) {
    if (message.role !== "assistant") {
      continue;
    }

    for (const part of message.parts) {
      if (part.type === "dynamic-tool" && part.state === "output-available") {
        toolResults.push({ toolName: part.toolName, output: part.output });
      }
    }
  }

  return toolResults;
}
