import type { EveMessage } from "eve/react";
import { describe, expect, it } from "vitest";
import { sourcesFromToolOutput, turnSources } from "./sources";

/**
 * "Used 3 sources" is a claim, and these are the ways it could be a false one:
 * citing a page the turn never read, dressing an error up as a result, handing a
 * reader a `javascript:` href, or inventing a title for a page that never gave
 * one. Nothing in the stream marks a source, so every guarantee lives here.
 */

function assistantMessage(parts: readonly { toolName: string; output: unknown }[]): EveMessage {
  return {
    id: "turn_0:assistant",
    parts: parts.map((part, index) => ({
      input: {},
      output: part.output,
      state: "output-available" as const,
      toolCallId: `call-${index}`,
      toolName: part.toolName,
      type: "dynamic-tool" as const,
    })),
    role: "assistant",
  };
}

describe("sourcesFromToolOutput", () => {
  it("reads the Exa search shape the gateway returns today", () => {
    const sources = sourcesFromToolOutput("web_search", {
      requestId: "req-1",
      results: [
        {
          id: "1",
          publishedDate: "2026-04-02",
          title: "Care and feeding of a sourdough starter",
          url: "https://example.com/sourdough",
        },
      ],
    });

    expect(sources).toEqual([
      {
        publishedAt: "2026-04-02",
        title: "Care and feeding of a sourdough starter",
        url: "https://example.com/sourdough",
      },
    ]);
  });

  it("reads the Parallel shape, whose date field is spelled differently", () => {
    const sources = sourcesFromToolOutput("web_search", {
      results: [
        { excerpt: "…", publishDate: "2026-01-09", title: "Rye", url: "https://example.com/rye" },
      ],
      searchId: "s-1",
    });

    expect(sources[0]).toEqual({
      publishedAt: "2026-01-09",
      title: "Rye",
      url: "https://example.com/rye",
    });
  });

  it("reads the bare array shape", () => {
    const sources = sourcesFromToolOutput("web_search", [
      { title: null, type: "web_search_result", url: "https://www.example.org/a" },
    ]);

    // No title, so the hostname stands in - and the bare `www.` is not a name.
    expect(sources).toEqual([{ title: "example.org", url: "https://www.example.org/a" }]);
  });

  it("takes the resolved source envelope from web_fetch when it has one", () => {
    const sources = sourcesFromToolOutput("web_fetch", {
      content: "…",
      contentType: "text/html",
      source: {
        contentType: "text/html",
        fetchedAt: "2026-09-01T10:00:00.000Z",
        title: "A page",
        url: "https://example.com/page",
      },
      truncated: false,
      url: "https://example.com/page",
    });

    expect(sources).toEqual([{ title: "A page", url: "https://example.com/page" }]);
  });

  it("still cites the page when web_fetch carries only the url it read", () => {
    const sources = sourcesFromToolOutput("web_fetch", {
      content: "…",
      contentType: "text/html",
      truncated: false,
      url: "https://example.com/page",
    });

    expect(sources).toEqual([{ title: "example.com", url: "https://example.com/page" }]);
  });

  it("cites nothing for a failed search", () => {
    expect(
      sourcesFromToolOutput("web_search", { error: "rate_limited", message: "Try later" }),
    ).toEqual([]);
  });

  it("cites nothing for a tool that does not reach the web", () => {
    expect(
      sourcesFromToolOutput("search_people", { results: [{ url: "https://example.com" }] }),
    ).toEqual([]);
  });

  it("drops a result whose url is not a page a browser should open", () => {
    const sources = sourcesFromToolOutput("web_search", {
      results: [
        { title: "Bad", url: "javascript:alert(1)" },
        { title: "Also bad", url: "data:text/html,<script>" },
        { title: "Fine", url: "https://example.com/ok" },
      ],
    });

    expect(sources.map((source) => source.url)).toEqual(["https://example.com/ok"]);
  });

  it("survives output that is not an object at all", () => {
    expect(sourcesFromToolOutput("web_search", null)).toEqual([]);
    expect(sourcesFromToolOutput("web_fetch", "a string")).toEqual([]);
  });
});

describe("turnSources", () => {
  it("keeps the order the turn read them and cites each page once", () => {
    const message = assistantMessage([
      {
        output: { results: [{ title: "A", url: "https://example.com/a" }] },
        toolName: "web_search",
      },
      { output: { url: "https://example.com/b" }, toolName: "web_fetch" },
      // The same page again, from a second search - one citation, not two.
      {
        output: { results: [{ title: "A", url: "https://example.com/a" }] },
        toolName: "web_search",
      },
    ]);

    expect(turnSources(message).map((source) => source.url)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("caps a runaway search at ten", () => {
    const message = assistantMessage([
      {
        output: {
          results: Array.from({ length: 25 }, (_, index) => ({
            title: `Result ${index}`,
            url: `https://example.com/${index}`,
          })),
        },
        toolName: "web_search",
      },
    ]);

    expect(turnSources(message)).toHaveLength(10);
  });

  it("cites nothing for a fetch that never produced output", () => {
    const message: EveMessage = {
      id: "turn_0:assistant",
      parts: [
        {
          approval: { id: "req-1", approved: false },
          input: { url: "https://example.com/denied" },
          state: "output-denied",
          toolCallId: "call-1",
          toolName: "web_fetch",
          type: "dynamic-tool",
        },
      ],
      role: "assistant",
    };

    expect(turnSources(message)).toEqual([]);
  });
});
