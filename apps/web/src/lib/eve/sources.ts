import type { AssistantSource } from "@tendnote/domain/assistant-sources";
import { sourcesFromToolOutput } from "@tendnote/domain/assistant-sources";
import type { EveMessage, EveMessagePart } from "eve/react";

export type { AssistantSource } from "@tendnote/domain/assistant-sources";
export { sourcesFromToolOutput } from "@tendnote/domain/assistant-sources";

/**
 * The web pages one assistant turn actually read, synthesized from tool output.
 *
 * Eve's part union has no source part: a URL only ever travels inside a
 * `dynamic-tool` part's `output` JSON. So "Used 3 sources" is a client-side
 * projection over the two tools that reach the open web - `web_search` (a
 * provider-executed search) and `web_fetch` (an approval-gated read of one
 * page). Nothing else contributes: a source strip that listed the notebook's own
 * records would claim the answer came from outside when it came from the user's
 * own memory.
 *
 * `sourcesFromToolOutput` (the per-tool-result normalizer) lives in
 * `@tendnote/domain/assistant-sources` so the agent reads the exact same
 * shapes; this file only owns walking eve's message/part structure, which is
 * a web-app concern the shared package cannot depend on.
 */

/** The most sources one turn's strip will list. */
const MAX_TURN_SOURCES = 10;

function isCompletedToolPart(
  part: EveMessagePart,
): part is Extract<EveMessagePart, { type: "dynamic-tool" }> & { output: unknown } {
  return part.type === "dynamic-tool" && part.state === "output-available";
}

/**
 * Every web page one assistant turn read, in the order the turn read them,
 * deduplicated by URL and capped. Only terminal `output-available` parts count:
 * a fetch that was denied, errored, or is still running cited nothing.
 */
export function turnSources(message: EveMessage): AssistantSource[] {
  if (message.role !== "assistant") {
    return [];
  }

  const seen = new Set<string>();
  const sources: AssistantSource[] = [];

  for (const part of message.parts) {
    if (!isCompletedToolPart(part)) {
      continue;
    }
    for (const source of sourcesFromToolOutput(part.toolName, part.output)) {
      if (seen.has(source.url)) {
        continue;
      }
      seen.add(source.url);
      sources.push(source);
      if (sources.length === MAX_TURN_SOURCES) {
        return sources;
      }
    }
  }

  return sources;
}
