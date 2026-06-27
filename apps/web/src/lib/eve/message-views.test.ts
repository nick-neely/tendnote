import type { EveMessage } from "eve/react";
import { describe, expect, it } from "vitest";
import { messageActiveToolViews, messageText, messageToolViews } from "./message-views";

describe("messageText (streamed assistant text)", () => {
  it("concatenates text parts in order and ignores non-text parts", () => {
    const message: EveMessage = {
      id: "m1",
      role: "assistant",
      parts: [
        { type: "text", text: "Saved ", state: "done" },
        { type: "step-start" },
        { type: "text", text: "that note.", state: "streaming" },
      ],
    };

    expect(messageText(message)).toBe("Saved that note.");
  });
});

describe("messageToolViews (persisted tool results → renderable views)", () => {
  it("maps output-available tool parts on assistant messages to views", () => {
    const message: EveMessage = {
      id: "m1",
      role: "assistant",
      parts: [
        { type: "text", text: "Done.", state: "done" },
        {
          type: "dynamic-tool",
          toolCallId: "call-1",
          toolName: "capture_source_record",
          state: "output-available",
          input: { retainedContent: "Had lunch with Mark." },
          output: {
            sourceRecord: { id: "source-1", content: "Had lunch with Mark." },
            linkedPersonId: "person-1",
          },
        },
      ],
    };

    expect(messageToolViews(message)).toEqual([
      {
        toolCallId: "call-1",
        view: {
          kind: "saved_source_record",
          sourceRecordId: "source-1",
          content: "Had lunch with Mark.",
          linkedPersonId: "person-1",
        },
      },
    ]);
  });

  it("keys each result on its tool call id so repeated same-tool calls stay distinct", () => {
    const message: EveMessage = {
      id: "turn_0:assistant",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolCallId: "call-1",
          toolName: "search_people",
          state: "output-available",
          input: { query: "Alex" },
          output: { people: [], requiresDisambiguation: false },
        },
        {
          type: "dynamic-tool",
          toolCallId: "call-2",
          toolName: "search_people",
          state: "output-available",
          input: { query: "Alex" },
          output: { people: [], requiresDisambiguation: false },
        },
      ],
    };

    const entries = messageToolViews(message);

    // Same tool name, distinct call ids — the React key derives from the id, so
    // a looping turn no longer collapses to one colliding key.
    expect(entries.map((entry) => entry.toolCallId)).toEqual(["call-1", "call-2"]);
    expect(new Set(entries.map((entry) => entry.toolCallId)).size).toBe(2);
  });

  it("skips tool calls that have not produced a persisted output yet", () => {
    const message: EveMessage = {
      id: "m1",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolCallId: "call-1",
          toolName: "search_people",
          state: "input-available",
          input: { query: "Mark" },
        },
        {
          type: "dynamic-tool",
          toolCallId: "call-2",
          toolName: "capture_memory",
          state: "output-error",
          errorText: "boom",
          input: {},
        },
      ],
    };

    expect(messageToolViews(message)).toEqual([]);
  });

  it("ignores tool parts that appear on non-assistant messages", () => {
    const message: EveMessage = {
      id: "m1",
      role: "user",
      parts: [
        {
          type: "dynamic-tool",
          toolCallId: "call-1",
          toolName: "capture_source_record",
          state: "output-available",
          input: {},
          output: { sourceRecord: { id: "source-1", content: "x" } },
        },
      ],
    };

    expect(messageToolViews(message)).toEqual([]);
  });
});

describe("messageActiveToolViews (in-flight tool calls → working lines)", () => {
  it("surfaces input-streaming and input-available calls with present-continuous labels", () => {
    const message: EveMessage = {
      id: "m1",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolCallId: "call-1",
          toolName: "search_people",
          state: "input-available",
          input: { query: "Alex" },
        },
        {
          type: "dynamic-tool",
          toolCallId: "call-2",
          toolName: "do_a_new_thing",
          state: "input-streaming",
          input: {},
        },
      ],
    };

    expect(messageActiveToolViews(message)).toEqual([
      { toolCallId: "call-1", label: "Searching people…" },
      { toolCallId: "call-2", label: "do a new thing…" },
    ]);
  });

  it("skips completed, errored, and non-assistant parts", () => {
    const completed: EveMessage = {
      id: "m1",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolCallId: "call-1",
          toolName: "search_people",
          state: "output-available",
          input: {},
          output: { people: [], requiresDisambiguation: false },
        },
        {
          type: "dynamic-tool",
          toolCallId: "call-2",
          toolName: "capture_memory",
          state: "output-error",
          errorText: "boom",
          input: {},
        },
      ],
    };
    const onUser: EveMessage = {
      id: "m2",
      role: "user",
      parts: [
        {
          type: "dynamic-tool",
          toolCallId: "call-3",
          toolName: "search_people",
          state: "input-available",
          input: {},
        },
      ],
    };

    expect(messageActiveToolViews(completed)).toEqual([]);
    expect(messageActiveToolViews(onUser)).toEqual([]);
  });
});
