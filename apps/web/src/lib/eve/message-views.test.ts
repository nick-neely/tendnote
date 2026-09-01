import type { EveMessage, EveMessagePart } from "eve/react";
import { describe, expect, it } from "vitest";
import type { AssistantToolEntry } from "./message-views";
import {
  type AssistantToolUnit,
  groupTurnToolEntries,
  isTurnInFlight,
  messageActiveToolViews,
  messageText,
  messageTextSegments,
  messageToolViews,
  messageTurnUnits,
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

  function kinds(units: AssistantToolUnit[]): string[] {
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

describe("messageTurnUnits (a turn's tool activity, in the order it happened)", () => {
  /** eve's own approval request for one gated call: fixed prompt, approve / cancel. */
  const saveRequest = {
    kind: "tool-approval" as const,
    requestId: "req-1",
    prompt: "Approve tool call: capture_memory",
    display: "confirmation" as const,
    allowFreeform: false,
    options: [
      { id: "approve", label: "Approve" },
      { id: "cancel", label: "Cancel" },
    ],
  };

  function types(units: ReturnType<typeof messageTurnUnits>): string[] {
    return units.map((unit) => unit.type);
  }

  /**
   * The ordering contract. A parked approval belongs where its tool call sits, not
   * at the bottom of the turn: the owner is deciding about the call Eve just made,
   * and a card that floated below every result would be asking about the wrong one.
   */
  it("keeps a parked approval in the slot its tool call occupies", () => {
    const message: EveMessage = {
      id: "turn_0:assistant",
      role: "assistant",
      parts: [
        { type: "text", text: "Adding Mara.", state: "done" },
        {
          type: "dynamic-tool",
          toolCallId: "call-1",
          toolName: "create_person",
          state: "output-available",
          input: {},
          output: { person: { id: "person-1", displayName: "Mara" } },
        },
        {
          type: "dynamic-tool",
          toolCallId: "call-2",
          toolName: "capture_memory",
          state: "approval-requested",
          approval: { id: "req-1" },
          input: { content: "Allergic to shellfish.", personId: "person-1" },
          toolMetadata: {
            eve: { kind: "tool-call", name: "capture_memory", inputRequest: saveRequest },
          },
        },
        {
          type: "dynamic-tool",
          toolCallId: "call-3",
          toolName: "search_people",
          state: "input-available",
          input: {},
        },
      ],
    };

    expect(types(messageTurnUnits(message, true))).toEqual(["single", "request", "active"]);
  });

  /**
   * A gated call is one part in successive states, so it can never be both a working
   * line and a card. This pins that: the same call id in `approval-requested` yields
   * the card and nothing else, with the shimmer gone.
   */
  it("never renders a shimmer and an approval card for the same call", () => {
    const message: EveMessage = {
      id: "turn_0:assistant",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolCallId: "call-1",
          toolName: "capture_memory",
          state: "approval-requested",
          approval: { id: "req-1" },
          input: { content: "Allergic to shellfish.", personId: "person-1" },
          toolMetadata: {
            eve: { kind: "tool-call", name: "capture_memory", inputRequest: saveRequest },
          },
        },
      ],
    };

    const units = messageTurnUnits(message, true);
    expect(types(units)).toEqual(["request"]);
    expect(units[0]?.type === "request" && units[0].request.toolCallId).toBe("call-1");
  });

  /**
   * A parked turn is durably waiting on a person, not working, so its stream has
   * already ended and `turnInFlight` is false. The card has to outlive that or the
   * decision would vanish the moment it was asked for.
   */
  it("keeps the approval card after the stream settles, unlike a working line", () => {
    const message: EveMessage = {
      id: "turn_0:assistant",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolCallId: "call-1",
          toolName: "capture_memory",
          state: "approval-requested",
          approval: { id: "req-1" },
          input: { content: "Allergic to shellfish.", personId: "person-1" },
          toolMetadata: {
            eve: { kind: "tool-call", name: "capture_memory", inputRequest: saveRequest },
          },
        },
        {
          type: "dynamic-tool",
          toolCallId: "call-2",
          toolName: "search_people",
          state: "input-available",
          input: {},
        },
      ],
    };

    expect(types(messageTurnUnits(message, false))).toEqual(["request"]);
  });

  it("renders a settled approval as its own unit where the card stood", () => {
    const message: EveMessage = {
      id: "turn_0:assistant",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolCallId: "call-1",
          toolName: "capture_memory",
          state: "output-denied",
          approval: { id: "req-1", approved: false, reason: "Tool execution was cancelled." },
          input: {},
          toolMetadata: {
            eve: { kind: "tool-call", name: "capture_memory", inputRequest: saveRequest },
          },
        },
      ],
    };

    const units = messageTurnUnits(message, false);
    expect(types(units)).toEqual(["resolution"]);
    expect(units[0]?.type === "resolution" && units[0].resolution.outcome).toBe("declined");
  });

  it("still folds same-kind saves into one group, held at the first one's slot", () => {
    function memoryPart(id: string, content: string): EveMessagePart {
      return {
        type: "dynamic-tool",
        toolCallId: id,
        toolName: "capture_memory",
        state: "output-available",
        input: {},
        output: {
          memory: { id, content, sourceRecordId: null },
          person: { id: "person-1", displayName: "Mara" },
        },
      };
    }

    const message: EveMessage = {
      id: "turn_0:assistant",
      role: "assistant",
      parts: [
        memoryPart("m1", "Allergic to shellfish."),
        memoryPart("m2", "Plays weekend soccer."),
        {
          type: "dynamic-tool",
          toolCallId: "call-9",
          toolName: "search_people",
          state: "input-available",
          input: {},
        },
      ],
    };

    const units = messageTurnUnits(message, true);
    expect(types(units)).toEqual(["group", "active"]);
  });

  it("ignores tool parts on a user message", () => {
    const message: EveMessage = {
      id: "turn_0:user",
      role: "user",
      parts: [
        {
          type: "dynamic-tool",
          toolCallId: "call-1",
          toolName: "capture_memory",
          state: "approval-requested",
          approval: { id: "req-1" },
          input: { content: "Allergic to shellfish.", personId: "person-1" },
          toolMetadata: {
            eve: { kind: "tool-call", name: "capture_memory", inputRequest: saveRequest },
          },
        },
      ],
    };

    expect(messageTurnUnits(message, true)).toEqual([]);
  });
});
