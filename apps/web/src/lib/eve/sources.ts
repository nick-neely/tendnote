import type { EveMessage, EveMessagePart } from "eve/react";

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
 * Three search shapes are tolerated because the provider behind `web_search` is
 * a gateway detail the client must not depend on: Exa's `{requestId, results}`,
 * Parallel's `{searchId, results}` with `excerpt`/`publishDate`, and Anthropic's
 * bare array of `web_search_result` objects. Each is read leniently - a result
 * without a usable URL is dropped rather than rendered as a dead link.
 */

/** One web page a turn read, as the sources strip renders it. */
export type AssistantSource = {
  readonly url: string;
  readonly title: string;
  readonly publishedAt?: string;
};

/** The most sources one turn's strip will list. */
const MAX_TURN_SOURCES = 10;

const WEB_SOURCE_TOOLS = new Set(["web_search", "web_fetch"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * The URL, only when it is a page a browser can safely open. A tool result is
 * untrusted external text (the agent stamps it `trust: "untrusted_external"`),
 * so a `javascript:` or `data:` href reaching an anchor would be an injection
 * the sources strip handed the user. Only `http(s)` survives.
 */
function safeUrl(value: unknown): URL | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * A source's display name. The page's own title when it has one; otherwise the
 * hostname, which is the honest answer - inventing a title from the URL path
 * would put words in the page's mouth.
 */
function toSource(
  rawUrl: unknown,
  rawTitle: unknown,
  rawPublishedAt: unknown,
): AssistantSource | null {
  const url = safeUrl(rawUrl);
  if (!url) {
    return null;
  }
  const title = optionalString(rawTitle) ?? url.hostname.replace(/^www\./, "");
  const publishedAt = optionalString(rawPublishedAt);
  return publishedAt ? { publishedAt, title, url: url.href } : { title, url: url.href };
}

/** The `results` array across every tolerated search shape. */
function searchResults(output: unknown): unknown[] {
  if (Array.isArray(output)) {
    return output;
  }
  if (isRecord(output) && Array.isArray(output.results)) {
    return output.results;
  }
  return [];
}

function webSearchSources(output: unknown): AssistantSource[] {
  return searchResults(output)
    .filter(isRecord)
    .map((result) => toSource(result.url, result.title, result.publishedDate ?? result.publishDate))
    .filter((source): source is AssistantSource => source !== null);
}

/**
 * The page `web_fetch` read. The tool carries a `source` envelope with the
 * resolved title; older results (and any run against an agent that has not
 * shipped it yet) carry only the `url` it fetched, which still names a real
 * page - so the fallback keeps the citation rather than dropping it.
 */
function webFetchSources(output: unknown): AssistantSource[] {
  if (!isRecord(output)) {
    return [];
  }
  const source = isRecord(output.source)
    ? toSource(output.source.url, output.source.title, undefined)
    : null;
  const fallback = source ?? toSource(output.url, undefined, undefined);
  return fallback ? [fallback] : [];
}

/**
 * The sources one tool result cites. Total: an unrecognized tool, an error
 * payload (`{error, message}`), or any shape that does not carry a usable URL
 * all yield nothing rather than a placeholder.
 */
export function sourcesFromToolOutput(toolName: string, output: unknown): AssistantSource[] {
  if (!WEB_SOURCE_TOOLS.has(toolName)) {
    return [];
  }
  if (isRecord(output) && typeof output.error === "string") {
    return [];
  }
  return toolName === "web_fetch" ? webFetchSources(output) : webSearchSources(output);
}

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
