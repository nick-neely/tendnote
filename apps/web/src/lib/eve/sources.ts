import type { AssistantSource } from "@tendnote/domain/assistant-sources";
import { hostLabel, sourcesFromToolOutput } from "@tendnote/domain/assistant-sources";
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

/** One line of the sources strip: where it goes, what it is called, whose site it is. */
export type AssistantSourceRow = {
  readonly url: string;
  readonly title: string;
  /** The bare domain, rendered in mono - a machine fact, per DESIGN.md §4. */
  readonly host: string;
};

/**
 * The strip's display rows, deduplicated by what the reader can actually see.
 *
 * {@link turnSources} already dedupes by URL, which is the honest unit for "how
 * many pages did this turn read". It is the wrong unit for a *list*: two URLs on
 * one site can carry the same title (a canonical page and its `?utm=` twin, a
 * fetch that followed a search hit), and the strip then shows the same line
 * twice with nothing to tell them apart. Title-and-host is what a row is, so it
 * is what a duplicate row is too.
 */
export function sourceRows(sources: readonly AssistantSource[]): AssistantSourceRow[] {
  const seen = new Set<string>();
  const rows: AssistantSourceRow[] = [];

  for (const source of sources) {
    const host = hostLabel(source.url);
    const key = `${host} ${source.title}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    rows.push({ host, title: source.title, url: source.url });
  }

  return rows;
}
