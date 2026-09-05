import { describe, expect, it } from "vitest";
import type { AssistantInputRequestView, AssistantInputResolutionView } from "./input-request-view";
import type { AssistantToolEntry } from "./message-views";
import { turnUnitKey } from "./turn-unit-key";

/**
 * A key is invisible until it is wrong, and then it is a card that remounts mid-turn,
 * a disclosure that springs shut, or two React children fighting over one slot. These
 * pin the three promises the renderer relies on: a group never collides with a lone
 * result of the same kind, a parked call and its settled status share a key so the
 * card is replaced rather than remounted, and every other unit is keyed by the call
 * eve guaranteed unique.
 */

function entry(toolCallId: string, memoryId = "mem-1"): AssistantToolEntry {
  return {
    toolCallId,
    toolName: "capture_memory",
    view: {
      kind: "saved_memory",
      memoryId,
      sourceRecordId: null,
      personId: null,
      personName: null,
      content: "Prefers tea",
    },
  };
}

const request: AssistantInputRequestView = {
  requestId: "req-1",
  toolCallId: "call-park",
  toolName: "capture_memory",
  kind: "tool-approval",
  prompt: "Approve tool call: capture_memory",
  display: "confirmation",
  allowFreeform: false,
  options: [],
  fields: [],
  input: { content: "Prefers tea" },
};

const resolution: AssistantInputResolutionView = {
  toolCallId: "call-park",
  requestId: "req-1",
  toolName: "capture_memory",
  kind: "tool-approval",
  prompt: "Approve tool call: capture_memory",
  outcome: "approved",
  fields: [],
  answerLabel: null,
  detail: null,
};

describe("turnUnitKey", () => {
  it("keys a single result by its own call", () => {
    expect(turnUnitKey("m1", { type: "single", entry: entry("call-a") })).toBe("m1:call-a");
  });

  it("keys a group by its kind and first member, so it cannot collide with a lone result", () => {
    const group = turnUnitKey("m1", {
      type: "group",
      kind: "saved_memory",
      entries: [entry("call-a"), entry("call-b", "mem-2")],
    });

    expect(group).toBe("m1:group:saved_memory:call-a");
    expect(group).not.toBe(turnUnitKey("m1", { type: "single", entry: entry("call-a") }));
  });

  it("gives a parked call and the status it settles into the same key", () => {
    // One message part in two states, so the card is replaced in place: a new key
    // here would unmount the approval and animate a status line in beneath it.
    expect(turnUnitKey("m1", { type: "request", request })).toBe(
      turnUnitKey("m1", { type: "resolution", resolution }),
    );
  });

  /**
   * A batch is not the card of its first member. Sharing that key would hand the
   * batch card the single card's mounted state - its open disclosure, its half-sent
   * decision - the moment a turn parked a second call.
   */
  it("keys a batch apart from the single card of its first member", () => {
    const second = { ...request, requestId: "req-2", toolCallId: "call-park-2" };
    const batch = { type: "request-batch", requests: [request, second] } as const;

    expect(turnUnitKey("m1", batch)).toBe("m1:batch:call-park");
    expect(turnUnitKey("m1", batch)).not.toBe(turnUnitKey("m1", { type: "request", request }));
  });

  it("keys a working line by the call it is a claim about", () => {
    expect(
      turnUnitKey("m1", { type: "active", active: { toolCallId: "call-c", label: "Saving…" } }),
    ).toBe("m1:call-c");
  });

  it("scopes every key to its message, so two turns calling the same tool stay apart", () => {
    expect(turnUnitKey("m1", { type: "single", entry: entry("call-a") })).not.toBe(
      turnUnitKey("m2", { type: "single", entry: entry("call-a") }),
    );
  });
});
