import { describe, expect, it } from "vitest";
import { sourcesFromToolOutput } from "./assistant-sources";

/**
 * One Exa success as it reaches `part.output`: the gateway's default web search
 * backend, verbatim provider JSON with nullable titles and dates, trimmed here
 * to the fields a citation reads.
 */
const exaSuccess = {
  requestId: "req_1",
  searchTime: 412.5,
  results: [
    {
      url: "https://www.whirlpool.com/support/edr1rxd1.html",
      id: "https://www.whirlpool.com/support/edr1rxd1.html",
      title: "EveryDrop Filter 1 (EDR1RXD1) - Whirlpool Support",
      publishedDate: "2024-11-02T00:00:00.000Z",
      author: null,
      summary: "Replacement schedule and compatible models.",
      highlights: ["Replace every six months."],
    },
    {
      url: "https://example.com/filters",
      id: "https://example.com/filters",
      title: null,
      publishedDate: null,
      author: null,
    },
  ],
};

/** The sibling error variant: same tool, same part, no `results` at all. */
const exaError = { error: "rate_limit", message: "Too many requests", statusCode: 429 };

/** What `agent/tools/web_fetch.ts` returns from `execute`. */
const webFetchOutput = {
  content: "# EveryDrop Filter 1\n\nReplace every six months.",
  contentType: "text/markdown",
  truncated: false,
  url: "https://www.whirlpool.com/support/edr1rxd1.html",
  source: {
    url: "https://www.whirlpool.com/support/edr1rxd1.html",
    title: "EveryDrop Filter 1",
    fetchedAt: "2026-09-02T10:00:00.000Z",
    contentType: "text/markdown",
  },
};

describe("web_search sources", () => {
  it("normalizes an Exa result page in the provider's own order", () => {
    expect(sourcesFromToolOutput("web_search", exaSuccess)).toEqual([
      {
        url: "https://www.whirlpool.com/support/edr1rxd1.html",
        title: "EveryDrop Filter 1 (EDR1RXD1) - Whirlpool Support",
        publishedAt: "2024-11-02T00:00:00.000Z",
      },
      // A null title is not a missing source: the host is a fine citation, and a
      // null date is simply omitted rather than rendered as "null".
      { url: "https://example.com/filters", title: "example.com" },
    ]);
  });

  it("yields nothing for the error variant rather than reading it as a result", () => {
    // The discriminator has to be the presence of `results`; a future error
    // shape without an `error` key must still produce no sources.
    expect(sourcesFromToolOutput("web_search", exaError)).toEqual([]);
    expect(sourcesFromToolOutput("web_search", { message: "boom" })).toEqual([]);
  });

  it("reads Parallel's publish date too, so pinning the other backend is not a rewrite", () => {
    expect(
      sourcesFromToolOutput("web_search", {
        searchId: "s_1",
        results: [{ url: "https://example.com/a", title: "A", publishDate: "2025-01-01" }],
      }),
    ).toEqual([{ url: "https://example.com/a", title: "A", publishedAt: "2025-01-01" }]);
  });

  it("reads the bare array shape Anthropic's native backend returns", () => {
    expect(
      sourcesFromToolOutput("web_search", [
        { title: null, type: "web_search_result", url: "https://www.example.org/a" },
      ]),
      // No title, so the hostname stands in - and the bare `www.` is not a name.
    ).toEqual([{ title: "example.org", url: "https://www.example.org/a" }]);
  });

  it("drops every URL a citation must not become an anchor for", () => {
    expect(
      sourcesFromToolOutput("web_search", {
        results: [
          { url: "javascript:alert(1)", title: "Click me" },
          { url: "data:text/html,<script>", title: "Also me" },
          { url: "not a url at all", title: "Nor me" },
          { url: "", title: "Empty" },
          { url: 42, title: "Number" },
          { url: "https://example.com/ok", title: "Fine" },
        ],
      }),
    ).toEqual([{ url: "https://example.com/ok", title: "Fine" }]);
  });

  it("dedupes by URL, keeps first order, and caps the strip at ten", () => {
    const results = [
      { url: "https://example.com/a", title: "First" },
      { url: "https://example.com/a", title: "Duplicate" },
      ...Array.from({ length: 15 }, (_, index) => ({
        url: `https://example.com/${index}`,
        title: `Result ${index}`,
      })),
    ];
    const sources = sourcesFromToolOutput("web_search", { results });

    expect(sources).toHaveLength(10);
    expect(sources[0]).toEqual({ url: "https://example.com/a", title: "First" });
    expect(new Set(sources.map((source) => source.url)).size).toBe(10);
  });

  it("caps a long title rather than rendering it verbatim", () => {
    const longTitle = "x".repeat(250);
    const sources = sourcesFromToolOutput("web_search", {
      results: [{ url: "https://example.com/long", title: longTitle }],
    });

    expect(sources[0]?.title).toHaveLength(200);
    expect(sources[0]?.title.endsWith("…")).toBe(true);
  });
});

describe("web_fetch sources", () => {
  it("reads the citation the tool already extracted", () => {
    expect(sourcesFromToolOutput("web_fetch", webFetchOutput)).toEqual([
      { url: "https://www.whirlpool.com/support/edr1rxd1.html", title: "EveryDrop Filter 1" },
    ]);
  });

  it("falls back to the final URL for output that predates the source field", () => {
    const { source: _source, ...withoutSource } = webFetchOutput;
    expect(sourcesFromToolOutput("web_fetch", withoutSource)).toEqual([
      { url: "https://www.whirlpool.com/support/edr1rxd1.html", title: "whirlpool.com" },
    ]);
  });
});

describe("everything else", () => {
  it("yields nothing rather than guessing", () => {
    for (const output of [null, undefined, "text", 7, [], { results: "nope" }, { source: 1 }]) {
      expect(sourcesFromToolOutput("web_search", output)).toEqual([]);
      expect(sourcesFromToolOutput("web_fetch", output)).toEqual([]);
    }
    // A tool that is not a web tool has no sources, whatever its output looks like.
    expect(sourcesFromToolOutput("get_person_context", exaSuccess)).toEqual([]);
    expect(sourcesFromToolOutput("search_people", webFetchOutput)).toEqual([]);
  });
});
