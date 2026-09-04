import type { EveMessage } from "eve/react";
import { describe, expect, it } from "vitest";
import { webTaintedToolCallIds } from "./conversation-taint";

/**
 * The client's reading of a Tainted Conversation. It explains a card; it never
 * decides one - so what these pin is that "before" means transcript order and that
 * a web tool never taints the very call that is asking to read the web.
 */

function toolPart(toolCallId: string, toolName: string) {
  return {
    type: "dynamic-tool" as const,
    toolCallId,
    toolName,
    state: "output-available" as const,
    input: {},
    output: {},
  };
}

function assistantTurn(id: string, parts: EveMessage["parts"]): EveMessage {
  return { id, role: "assistant", parts };
}

describe("webTaintedToolCallIds", () => {
  it("claims nothing about a conversation that never reached the web", () => {
    const messages = [
      assistantTurn("m1", [
        toolPart("call-1", "search_people"),
        toolPart("call-2", "capture_memory"),
      ]),
    ];

    expect(webTaintedToolCallIds(messages)).toEqual(new Set());
  });

  it("taints every call after a page was read, and not the fetch that read it", () => {
    const messages = [
      assistantTurn("m1", [
        toolPart("call-1", "capture_memory"),
        toolPart("call-2", "web_fetch"),
        toolPart("call-3", "capture_memory"),
      ]),
    ];

    expect(webTaintedToolCallIds(messages)).toEqual(new Set(["call-3"]));
  });

  /**
   * `web_search` is provider-executed and invisible to the agent's hooks, which is
   * exactly why taint is derived from the transcript rather than announced by one.
   */
  it("counts a provider-executed search the same as a fetch", () => {
    const messages = [
      assistantTurn("m1", [toolPart("call-1", "web_search")]),
      assistantTurn("m2", [toolPart("call-2", "capture_memory")]),
    ];

    expect(webTaintedToolCallIds(messages)).toEqual(new Set(["call-2"]));
  });

  /** Nothing clears it: a later turn in the same conversation is still tainted. */
  it("carries across turns, because only a new conversation ends it", () => {
    const messages = [
      assistantTurn("m1", [toolPart("call-1", "web_fetch")]),
      { id: "m2", role: "user", parts: [{ type: "text", text: "Save that." }] } as EveMessage,
      assistantTurn("m3", [toolPart("call-2", "capture_memory")]),
      assistantTurn("m4", [toolPart("call-3", "create_person")]),
    ];

    expect(webTaintedToolCallIds(messages)).toEqual(new Set(["call-2", "call-3"]));
  });

  /**
   * A fetch the owner refused still put a URL through the turn, and the agent's own
   * derivation counts the part rather than its outcome. The two have to agree.
   */
  it("counts a web call whatever state it reached", () => {
    const messages = [
      assistantTurn("m1", [
        {
          type: "dynamic-tool",
          toolCallId: "call-1",
          toolName: "web_fetch",
          state: "approval-requested",
          approval: { id: "req-1" },
          input: { url: "https://example.com" },
        },
        toolPart("call-2", "capture_memory"),
      ]),
    ];

    expect(webTaintedToolCallIds(messages)).toEqual(new Set(["call-2"]));
  });
});
