import type { EveMessage } from "eve/react";
import { describe, expect, it } from "vitest";
import { sourcesFromToolOutput, turnSources } from "./sources";

/**
 * "Used 3 sources" is a claim, and these are the ways it could be a false one:
 * citing a page the turn never read, or citing the same page twice. Per-tool
 * normalization (Exa/Parallel/Anthropic shapes, error variants, url safety,
 * dedupe-and-cap within one result) is covered by
 * `packages/domain/src/assistant-sources.test.ts`, which this file's
 * `sourcesFromToolOutput` re-export is smoke-tested against below.
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

describe("sourcesFromToolOutput (re-export)", () => {
  it("is the shared domain normalizer, reachable from the eve module", () => {
    expect(
      sourcesFromToolOutput("web_search", {
        results: [{ title: "A", url: "https://example.com/a" }],
      }),
    ).toEqual([{ title: "A", url: "https://example.com/a" }]);
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
