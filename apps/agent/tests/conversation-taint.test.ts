import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  deriveConversationTaint,
  markConversationTainted,
  readConversationTaint,
  recordDerivedConversationTaint,
  resolveConversationTaint,
  UNTRUSTED_CONTENT_TOOL_NAMES,
} from "../agent/lib/conversation-taint";
import taintGate from "../agent/tools/conversation_taint_gate";

const UNTAINTED = { tainted: false, source: null };

/** An assistant turn that called a tool, in the shape the model history uses. */
function toolCall(toolName: string): ModelMessage {
  return {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId: "call-1", toolName, input: {} }],
  } as ModelMessage;
}

/** The tool message carrying a result back. */
function toolResult(toolName: string): ModelMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName,
        output: { type: "text", value: "..." },
      },
    ],
  } as ModelMessage;
}

function userText(text: string): ModelMessage {
  return { role: "user", content: text } as ModelMessage;
}

describe("deriveConversationTaint: what makes a conversation tainted", () => {
  it("finds a provider-executed web_search call", () => {
    // The case no hook can see: eve's step emitter excludes provider-executed
    // tool calls from every hook event, so the history is the only witness.
    expect(deriveConversationTaint([userText("who won?"), toolCall("web_search")])).toEqual({
      tainted: true,
      source: "web_search",
    });
  });

  it("finds a web_fetch result even without its call", () => {
    // A compacted or replayed history can carry the result alone.
    expect(deriveConversationTaint([toolResult("web_fetch")])).toEqual({
      tainted: true,
      source: "web_fetch",
    });
  });

  it("leaves an unrelated tool alone", () => {
    expect(
      deriveConversationTaint([
        toolCall("search_people"),
        toolResult("search_people"),
        userText("thanks"),
      ]),
    ).toEqual(UNTAINTED);
  });

  it("reads an empty history as untainted", () => {
    expect(deriveConversationTaint([])).toEqual(UNTAINTED);
  });

  it("keeps the first source when a conversation reads twice", () => {
    expect(deriveConversationTaint([toolCall("web_search"), toolCall("web_fetch")]).source).toBe(
      "web_search",
    );
  });

  it("is idempotent: the same history answers the same way every step", () => {
    const history = [userText("hi"), toolCall("web_fetch"), toolResult("web_fetch")];

    expect(deriveConversationTaint(history)).toEqual(deriveConversationTaint(history));
  });

  it.each([
    ["not an array", { messages: [] }],
    ["null", null],
    ["undefined", undefined],
    ["holding a null message", [null]],
    ["holding a message with no content", [{ role: "assistant" }]],
    ["holding a string content body", [{ role: "user", content: "web_fetch" }]],
    ["holding a null part", [{ role: "assistant", content: [null] }]],
    ["holding a part with no type", [{ role: "assistant", content: [{ toolName: "web_fetch" }] }]],
    [
      "naming the tool on the wrong part type",
      [{ role: "assistant", content: [{ type: "text", toolName: "web_fetch" }] }],
    ],
  ])("answers untainted for a history that is %s", (_name, messages) => {
    expect(deriveConversationTaint(messages)).toEqual(UNTAINTED);
  });

  it("names exactly the two tools that read Untrusted Content", () => {
    expect([...UNTRUSTED_CONTENT_TOOL_NAMES]).toEqual(["web_fetch", "web_search"]);
  });
});

describe("the state slot outside an eve context", () => {
  // `defineState` throws without an active ALS scope. Every accessor swallows
  // that, because the readers include an approval policy that must never throw
  // and the writers include `web_fetch`, which must not fail a fetch over an
  // audit detail.
  it("reads untainted rather than throwing", () => {
    expect(() => readConversationTaint()).not.toThrow();
    expect(readConversationTaint()).toEqual(UNTAINTED);
  });

  it("records nothing rather than throwing", () => {
    expect(() => markConversationTainted("web_fetch")).not.toThrow();
  });

  it("still reports what it derived", () => {
    expect(recordDerivedConversationTaint([toolCall("web_fetch")])).toEqual({
      tainted: true,
      source: "web_fetch",
    });
  });

  it("falls back to the history when the slot cannot be read", () => {
    expect(resolveConversationTaint([toolCall("web_search")])).toEqual({
      tainted: true,
      source: "web_search",
    });
    expect(resolveConversationTaint([])).toEqual(UNTAINTED);
  });
});

describe("the conversation_taint_gate resolver", () => {
  const resolve = (
    taintGate as { events: Record<string, (event: unknown, ctx: unknown) => unknown> }
  ).events["step.started"];

  it("subscribes to step.started and nothing else", () => {
    // `step.started` is the only dynamic event that sees the history as it grows
    // inside a turn, which is where a provider-executed search lands.
    expect(Object.keys((taintGate as { events: Record<string, unknown> }).events)).toEqual([
      "step.started",
    ]);
  });

  it("authors no tool", () => {
    // eve *skips* a resolver that throws, so contributing nothing has to be the
    // literal return value rather than an empty object it might mis-merge.
    expect(resolve?.({}, { messages: [toolCall("web_fetch")] })).toBeNull();
  });

  it.each([
    ["a malformed history", { messages: { nope: true } }],
    ["no messages at all", {}],
    ["no context", undefined],
  ])("never throws on %s", (_name, ctx) => {
    expect(() => resolve?.({}, ctx)).not.toThrow();
  });
});
