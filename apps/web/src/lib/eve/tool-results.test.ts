import type { EveMessageData } from "eve/client";
import { describe, expect, it } from "vitest";
import { collectToolResults } from "./tool-results";

function messageData(messages: EveMessageData["messages"]): EveMessageData {
  return { messages };
}

describe("collectToolResults (Eve turn → persisted tool results)", () => {
  it("collects output-available tool calls from assistant messages with their persisted output", () => {
    const data = messageData([
      {
        id: "m1",
        role: "assistant",
        parts: [
          { type: "text", text: "Saved that note.", state: "done" },
          {
            type: "dynamic-tool",
            toolCallId: "call-1",
            toolName: "capture_source_record",
            state: "output-available",
            input: { retainedContent: "Had lunch with Mark." },
            output: { sourceRecord: { id: "source-1" }, component: { type: "source_record" } },
          },
        ],
      },
    ]);

    const results = collectToolResults(data);

    expect(results).toEqual([
      {
        toolName: "capture_source_record",
        output: { sourceRecord: { id: "source-1" }, component: { type: "source_record" } },
      },
    ]);
  });

  it("skips tool calls that have not produced a persisted output yet", () => {
    const data = messageData([
      {
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
      },
    ]);

    expect(collectToolResults(data)).toEqual([]);
  });

  it("ignores tool parts that appear on non-assistant messages", () => {
    const data = messageData([
      {
        id: "m1",
        role: "user",
        parts: [
          {
            type: "dynamic-tool",
            toolCallId: "call-1",
            toolName: "capture_source_record",
            state: "output-available",
            input: {},
            output: { sourceRecord: { id: "source-1" } },
          },
        ],
      },
    ]);

    expect(collectToolResults(data)).toEqual([]);
  });
});
