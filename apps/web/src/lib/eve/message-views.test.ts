import type { EveMessage } from "eve/react";
import { describe, expect, it } from "vitest";
import type { AssistantToolEntry } from "./message-views";
import {
  type AssistantTurnUnit,
  groupTurnToolEntries,
  messageActiveToolViews,
  messageText,
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
        displayName: "Juli",
        relationshipType: "partner",
      }),
      entry("u1", {
        kind: "updated_person",
        personId: "person-1",
        displayName: "Juli",
        relationshipType: "partner",
        updatedFields: ["birthday"],
      }),
      memory("m1", "Together since 2023.", "Juli"),
      memory("m2", "They have four cats.", "Juli"),
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
        personName: "Juli",
      }),
      entry("c1", {
        kind: "person_context",
        personId: "person-1",
        personName: "Juli",
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
          toolName: "search_semantic_context",
          state: "input-streaming",
          input: {},
        },
      ],
    };

    expect(messageActiveToolViews(message)).toEqual([
      { toolCallId: "call-1", label: "Searching people…" },
      { toolCallId: "call-2", label: "Searching by meaning…" },
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
