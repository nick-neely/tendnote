import type { EveMessage } from "eve/react";
import { describe, expect, it } from "vitest";
import type { AssistantToolEntry } from "./message-views";
import {
  type AssistantTurnUnit,
  groupTurnToolEntries,
  isTurnInFlight,
  messageActiveToolViews,
  messageText,
  messageTextSegments,
  messageToolViews,
} from "./message-views";
import type { AssistantToolView } from "./tool-result-view";

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

describe("messageTextSegments (one block per thing Eve said)", () => {
  it("keeps each step's text apart so segments never run together", () => {
    const message: EveMessage = {
      id: "m1",
      role: "assistant",
      parts: [
        { type: "step-start" },
        { type: "text", text: "I'll look up Jordan Rivera.\n", state: "done", stepIndex: 0 },
        { type: "step-start" },
        { type: "text", text: "Found them.", state: "done", stepIndex: 1 },
        { type: "text", text: "   ", state: "streaming", stepIndex: 2 },
      ],
    };

    expect(messageTextSegments(message)).toEqual([
      { key: "text:0", text: "I'll look up Jordan Rivera." },
      { key: "text:1", text: "Found them." },
    ]);
  });

  it("falls back to position when a text part carries no step", () => {
    const message: EveMessage = {
      id: "m1",
      role: "assistant",
      parts: [
        { type: "text", text: "One.", state: "done" },
        { type: "text", text: "Two.", state: "done" },
      ],
    };

    expect(messageTextSegments(message).map((segment) => segment.key)).toEqual([
      "text:0",
      "text:1",
    ]);
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

describe("groupTurnToolEntries (folding same-kind durable saves into groups)", () => {
  function entry(id: string, view: AssistantToolView): AssistantToolEntry {
    return { toolCallId: id, view };
  }

  function memory(
    id: string,
    content: string,
    personName: string | null = null,
  ): AssistantToolEntry {
    return entry(id, {
      kind: "saved_memory",
      memoryId: id,
      sourceRecordId: null,
      personId: personName ? "person-1" : null,
      personName,
      content,
    });
  }

  function kinds(units: AssistantTurnUnit[]): string[] {
    return units.map((unit) =>
      unit.type === "group" ? `group:${unit.kind}` : unit.entry.view.kind,
    );
  }

  it("collapses several memories from one turn into a single group", () => {
    const units = groupTurnToolEntries([
      memory("m1", "Together since 2023."),
      memory("m2", "They have four cats."),
      memory("m3", "Works as a server."),
    ]);

    expect(units).toHaveLength(1);
    const group = units[0];
    expect(group?.type).toBe("group");
    if (group?.type === "group") {
      expect(group.kind).toBe("saved_memory");
      expect(group.entries).toHaveLength(3);
    }
  });

  it("keeps a lone durable save as a single so it still earns its own card", () => {
    const units = groupTurnToolEntries([memory("m1", "Just one fact.")]);

    expect(kinds(units)).toEqual(["saved_memory"]);
    expect(units[0]?.type).toBe("single");
  });

  it("groups by kind across the whole turn but holds each group at its first slot", () => {
    const units = groupTurnToolEntries([
      entry("p1", {
        kind: "added_person",
        personId: "person-1",
        displayName: "Mara",
        relationshipType: "partner",
      }),
      entry("u1", {
        kind: "updated_person",
        personId: "person-1",
        displayName: "Mara",
        relationshipType: "partner",
        updatedFields: ["birthday"],
      }),
      memory("m1", "Plays in a weekend soccer league.", "Mara"),
      memory("m2", "Allergic to shellfish.", "Mara"),
    ]);

    // One add, one update (each lone → single), and the two memories folded into a
    // group that sits where the first memory appeared.
    expect(kinds(units)).toEqual(["added_person", "updated_person", "group:saved_memory"]);
  });

  it("leaves interactive review results and lookups untouched and in place", () => {
    const units = groupTurnToolEntries([
      memory("m1", "Together since 2023."),
      memory("m2", "They have four cats."),
      entry("r1", {
        kind: "suggested_memory_review",
        memoryId: "s1",
        content: "Maybe switching jobs.",
        sourceRecordId: null,
        personId: "person-1",
        personName: "Mara",
      }),
      entry("c1", {
        kind: "person_context",
        personId: "person-1",
        personName: "Mara",
        snapshotStatus: "fresh",
        approvedCount: 0,
        loggedCount: 0,
        suggestedCount: 0,
      }),
    ]);

    expect(kinds(units)).toEqual([
      "group:saved_memory",
      "suggested_memory_review",
      "person_context",
    ]);
  });
});

describe("isTurnInFlight (which statuses mean Eve is still working)", () => {
  it("counts only the two live states, never a turn that has settled or failed", () => {
    expect(isTurnInFlight("submitted")).toBe(true);
    expect(isTurnInFlight("streaming")).toBe(true);
    expect(isTurnInFlight("ready")).toBe(false);
    expect(isTurnInFlight("error")).toBe(false);
  });
});

describe("messageActiveToolViews (in-flight tool calls → working lines)", () => {
  /** A turn left with a `search_people` call parked short of any terminal state. */
  const parkedSearch: EveMessage = {
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
    ],
  };

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
          toolName: "search_semantic_context",
          state: "input-streaming",
          input: {},
          inputText: "",
        },
      ],
    };

    expect(messageActiveToolViews(message, true)).toEqual([
      { toolCallId: "call-1", label: "Searching people…" },
      { toolCallId: "call-2", label: "Searching by meaning…" },
    ]);
  });

  /**
   * The orphan shimmer: Eve answered, the turn settled, and a `search_people`
   * part was left parked in `input-available` - claiming forever that a search
   * is running. A working line is a claim about now, so it ends with the turn.
   */
  it("drops a call parked mid-flight once the turn is no longer in flight", () => {
    expect(messageActiveToolViews(parkedSearch, true)).toHaveLength(1);
    expect(messageActiveToolViews(parkedSearch, false)).toEqual([]);
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

    expect(messageActiveToolViews(completed, true)).toEqual([]);
    expect(messageActiveToolViews(onUser, true)).toEqual([]);
  });
});
