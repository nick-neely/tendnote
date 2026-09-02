/**
 * Citable sources, normalized out of raw tool output.
 *
 * The Assistant's sources strip needs `{url, title}` per turn, and the stream
 * carries no source part to read it from: eve's `EveMessagePart` union has no
 * `source` variant, and AI SDK `source` parts are dropped by the harness. The
 * only place a source ever exists is the `output` of a `dynamic-tool` part -
 * raw provider JSON for `web_search`, our own `execute` return for `web_fetch`.
 *
 * So this file is the one reading of those shapes. It is deliberately pure:
 * no eve import, no `@tendnote/db` import, no I/O, nothing that assumes a
 * server. The web app renders the same strip from the same `part.output`, and
 * a shape read two different ways in two places is a shape that will disagree.
 *
 * ## The shapes it handles
 *
 * `web_search` is provider-executed: eve injects the provider's own tool and
 * puts the provider's raw JSON on `part.output` verbatim, so the shape is the
 * *backend's*, not eve's. Gateway-routed models (every model Tendnote ships)
 * resolve to Exa, whose success shape is
 *
 * ```
 * { requestId, results: [{ url, id, title?|null, publishedDate?|null,
 *                          author?|null, text?, summary?, highlights?, … }],
 *   searchTime?, … }
 * ```
 *
 * and whose failure shape is a sibling variant with no `results` at all:
 * `{ error: "rate_limit" | "timeout" | …, message, statusCode? }`. Both are
 * plain JSON on the same part, so the discriminator is the presence of a
 * `results` array, never the absence of `error`.
 *
 * Parallel - the other gateway backend eve can be configured with - is close
 * enough to fold in here rather than to guess wrong about later: same
 * `results` array, `publishDate` instead of `publishedDate`. Native OpenAI,
 * Anthropic, and Google backends only apply to direct/BYO provider models,
 * which Tendnote does not use, and are not handled.
 *
 * `web_fetch` is ours (`agent/tools/web_fetch.ts`), which returns
 * `{ content, contentType, truncated, url, source: { url, title, fetchedAt,
 * contentType } }`. `source` is the citation the tool already extracted; the
 * bare `url` is the fallback for output produced before that field existed.
 *
 * Anything else - another tool's name, a non-object, a denial, a partial - is
 * not a source and yields none.
 */

/** One citable source, in the shape the sources strip renders. */
export type NormalizedSource = {
  readonly url: string;
  readonly title: string;
  /** ISO-8601 publication date when the provider reported one. */
  readonly publishedAt?: string;
};

/**
 * At most this many sources per tool result. A search returns ten by
 * configuration today and the strip is a footnote, not a results page.
 */
const MAX_SOURCES = 10;

/** Titles are chrome for a link, not content. */
const MAX_TITLE_LENGTH = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * The href a citation may actually carry.
 *
 * Every source here is attacker-influenced - a page chose its own `<title>`, a
 * search provider chose which URLs to return - and the client turns these into
 * anchors. Restricting the scheme is the one check that has to happen before
 * the value leaves this function, not after.
 */
function readSourceUrl(value: unknown): string | undefined {
  const raw = readString(value);
  if (raw === undefined) return undefined;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? raw : undefined;
  } catch {
    return undefined;
  }
}

/** A readable label for a URL that came without one. */
function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function readTitle(value: unknown, url: string): string {
  const title = readString(value);
  if (title === undefined) return hostLabel(url);
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title;
}

function toSource(entry: unknown): NormalizedSource | undefined {
  if (!isRecord(entry)) return undefined;
  const url = readSourceUrl(entry.url);
  if (url === undefined) return undefined;

  // Exa reports `publishedDate`; Parallel reports `publishDate`. Both are
  // nullable, and neither is worth a source on its own.
  const publishedAt = readString(entry.publishedDate) ?? readString(entry.publishDate);

  return {
    url,
    title: readTitle(entry.title, url),
    ...(publishedAt === undefined ? {} : { publishedAt }),
  };
}

/** Provider search results, in the order the provider ranked them. */
function searchSources(output: unknown): NormalizedSource[] {
  if (!isRecord(output)) return [];
  // The error variant carries no `results`, so this same check covers it.
  const results = output.results;
  if (!Array.isArray(results)) return [];
  return results.map(toSource).filter((source): source is NormalizedSource => source !== undefined);
}

/** The single page a fetch returned. */
function fetchSources(output: unknown): NormalizedSource[] {
  if (!isRecord(output)) return [];
  const source = toSource(output.source);
  if (source !== undefined) return [source];
  // Output from before `web_fetch` carried a `source`: the final URL is still
  // a citation, it just has to wear its hostname as a title.
  const fallback = toSource({ url: output.url });
  return fallback === undefined ? [] : [fallback];
}

/**
 * Every citable source in one tool result, in stream order, deduped by URL and
 * capped. Returns an empty array for any tool, output, or entry this file does
 * not recognise - a missing source strip is the correct rendering of "nothing
 * was cited", and a guessed one is not.
 */
export function sourcesFromToolOutput(toolName: string, output: unknown): NormalizedSource[] {
  const sources =
    toolName === "web_search"
      ? searchSources(output)
      : toolName === "web_fetch"
        ? fetchSources(output)
        : [];

  const seen = new Set<string>();
  const deduped: NormalizedSource[] = [];
  for (const source of sources) {
    if (seen.has(source.url)) continue;
    seen.add(source.url);
    deduped.push(source);
    if (deduped.length === MAX_SOURCES) break;
  }
  return deduped;
}
