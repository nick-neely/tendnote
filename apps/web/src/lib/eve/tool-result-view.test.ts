import { describe, expect, it } from "vitest";
import {
  activeToolLabel,
  assistantToolViewKey,
  toAssistantToolView,
  toolViewTier,
} from "./tool-result-view";

describe("toAssistantToolView (Eve tool output → renderable view)", () => {
  it("renders a capture_source_record result as logged context with its persisted id", () => {
    const view = toAssistantToolView({
      toolName: "capture_source_record",
      output: {
        sourceRecord: { id: "source-1", status: "active", content: "Had lunch with Mark." },
        linkedPersonId: "person-1",
        component: { type: "source_record_review", sourceRecordId: "source-1" },
      },
    });

    expect(view).toEqual({
      kind: "saved_source_record",
      sourceRecordId: "source-1",
      content: "Had lunch with Mark.",
      linkedPersonId: "person-1",
    });
  });

  it("renders a capture_memory result as a saved memory grounded in its source record", () => {
    const view = toAssistantToolView({
      toolName: "capture_memory",
      output: {
        memory: {
          id: "memory-1",
          personId: "person-1",
          content: "Caleb is moving to Denver in August.",
          status: "approved",
          sourceRecordId: "source-1",
        },
        person: { id: "person-1", displayName: "Caleb" },
        component: {
          type: "memory_saved",
          memoryId: "memory-1",
          sourceRecordId: "source-1",
          personId: "person-1",
        },
      },
    });

    expect(view).toEqual({
      kind: "saved_memory",
      memoryId: "memory-1",
      sourceRecordId: "source-1",
      personId: "person-1",
      personName: "Caleb",
      content: "Caleb is moving to Denver in August.",
    });
  });

  it("renders a create_person result as an added person", () => {
    const view = toAssistantToolView({
      toolName: "create_person",
      output: {
        person: { id: "person-9", displayName: "Mara Lin", relationshipType: "friend" },
        component: { type: "person_created", personId: "person-9" },
      },
    });

    expect(view).toEqual({
      kind: "added_person",
      personId: "person-9",
      displayName: "Mara Lin",
      relationshipType: "friend",
    });
  });

  it("renders a get_person_context result with per-tier counts and snapshot status", () => {
    const view = toAssistantToolView({
      toolName: "get_person_context",
      output: {
        found: true,
        person: { id: "person-1", displayName: "Mark", relationshipType: "friend" },
        snapshotStatus: "fresh",
        approvedMemories: [{ id: "m1" }],
        sourceRecords: [{ id: "s1" }, { id: "s2" }],
        suggestedMemories: [{ id: "sug1" }],
        component: { type: "person_context", personId: "person-1", snapshotStatus: "fresh" },
      },
    });

    expect(view).toEqual({
      kind: "person_context",
      personId: "person-1",
      personName: "Mark",
      snapshotStatus: "fresh",
      approvedCount: 1,
      loggedCount: 2,
      suggestedCount: 1,
    });
  });

  it("renders a get_suggested_memory_review result as a tentative review item", () => {
    const view = toAssistantToolView({
      toolName: "get_suggested_memory_review",
      output: {
        found: true,
        memory: {
          id: "memory-2",
          personId: "person-1",
          content: "Maybe switching jobs.",
          status: "suggested",
          sourceRecordId: "source-2",
        },
        sourceRecord: { id: "source-2", content: "Mark mentioned a recruiter." },
        component: { type: "suggested_memory_review", memoryId: "memory-2" },
      },
    });

    expect(view).toEqual({
      kind: "suggested_memory_review",
      memoryId: "memory-2",
      content: "Maybe switching jobs.",
      sourceRecordId: "source-2",
    });
  });

  it("renders exact recall person results as compact typed references", () => {
    const view = toAssistantToolView({
      toolName: "search_relationship_context",
      output: {
        results: [
          {
            recordKind: "person",
            recordId: "person-1",
            relatedPersonId: "person-1",
            relatedPersonDisplayName: "Mara Lin",
            label: "Mara Lin",
            snippet: "Talked about backend architecture.",
            matchedFields: ["profileBlurb"],
            rank: 1.2,
            trustLevel: "identity_reference",
            sensitivity: "normal",
          },
        ],
        component: { type: "relationship_context_search", resultCount: 1 },
      },
    });

    expect(view).toEqual({
      kind: "relationship_context_search",
      results: [
        {
          recordKind: "person",
          recordId: "person-1",
          relatedPersonId: "person-1",
          relatedPersonDisplayName: "Mara Lin",
          label: "Mara Lin",
          snippet: "Talked about backend architecture.",
          matchedFields: ["profileBlurb"],
          trustLevel: "identity_reference",
          sensitivity: "normal",
        },
      ],
    });
  });

  it("keeps exact recall output compact and ignores full profiles or snapshot prose", () => {
    const view = toAssistantToolView({
      toolName: "search_relationship_context",
      output: {
        results: [
          {
            recordKind: "memory",
            recordId: "memory-1",
            relatedPersonId: "person-1",
            relatedPersonDisplayName: "Mara Lin",
            label: "Mara Lin",
            snippet: "Mara prefers backend architecture conversations.",
            matchedFields: ["content"],
            rank: 1.2,
            trustLevel: "confirmed_fact",
            sensitivity: "normal",
            fullProfile: "Do not render this.",
            snapshot: { summary: "Generated snapshot prose." },
          },
        ],
      },
    });

    expect(view).toEqual({
      kind: "relationship_context_search",
      results: [
        {
          recordKind: "memory",
          recordId: "memory-1",
          relatedPersonId: "person-1",
          relatedPersonDisplayName: "Mara Lin",
          label: "Mara Lin",
          snippet: "Mara prefers backend architecture conversations.",
          matchedFields: ["content"],
          trustLevel: "confirmed_fact",
          sensitivity: "normal",
        },
      ],
    });
    expect(JSON.stringify(view)).not.toContain("Generated snapshot prose");
    expect(JSON.stringify(view)).not.toContain("Do not render this");
  });

  it("degrades an unknown tool to a generic view", () => {
    const view = toAssistantToolView({ toolName: "some_future_tool", output: { whatever: true } });

    expect(view).toEqual({ kind: "generic", toolName: "some_future_tool" });
  });

  it("degrades malformed output for a known tool to a generic view instead of guessing", () => {
    const view = toAssistantToolView({ toolName: "capture_memory", output: { memory: null } });

    expect(view).toEqual({ kind: "generic", toolName: "capture_memory" });
  });

  it("keys a view on its persisted record id, not array position", () => {
    expect(
      assistantToolViewKey({
        kind: "saved_memory",
        memoryId: "memory-1",
        sourceRecordId: "source-1",
        personId: "person-1",
        personName: "Caleb",
        content: "x",
      }),
    ).toBe("memory:memory-1");
    expect(assistantToolViewKey({ kind: "generic", toolName: "some_future_tool" })).toBe(
      "tool:some_future_tool",
    );
    expect(
      assistantToolViewKey({
        kind: "relationship_context_search",
        results: [
          {
            recordKind: "person",
            recordId: "person-1",
            relatedPersonId: "person-1",
            relatedPersonDisplayName: "Mara Lin",
            label: "Mara Lin",
            snippet: "x",
            matchedFields: ["displayName"],
            trustLevel: "identity_reference",
            sensitivity: "normal",
          },
        ],
      }),
    ).toBe("search:person-1");
  });
});

describe("toolViewTier (how much weight a result earns)", () => {
  it("keeps durable, trust-bearing results as cards", () => {
    expect(
      toolViewTier({
        kind: "saved_memory",
        memoryId: "m1",
        sourceRecordId: null,
        personId: null,
        personName: null,
        content: "x",
      }),
    ).toBe("card");
    expect(
      toolViewTier({
        kind: "added_person",
        personId: "p1",
        displayName: "A",
        relationshipType: null,
      }),
    ).toBe("card");
    expect(
      toolViewTier({
        kind: "suggested_memory_review",
        memoryId: "m1",
        content: "x",
        sourceRecordId: null,
      }),
    ).toBe("card");
  });

  it("recedes ambient lookups to a quiet line", () => {
    expect(toolViewTier({ kind: "generic", toolName: "search_people" })).toBe("line");
    expect(
      toolViewTier({
        kind: "person_context",
        personId: "p1",
        personName: "Alex",
        snapshotStatus: "fresh",
        approvedCount: 2,
        loggedCount: 1,
        suggestedCount: 0,
      }),
    ).toBe("line");
  });

  it("collapses a non-empty search behind a disclosure but lines an empty one", () => {
    const result = {
      recordKind: "person" as const,
      recordId: "p1",
      relatedPersonId: "p1",
      relatedPersonDisplayName: "Alex",
      label: "Alex",
      snippet: "x",
      matchedFields: ["displayName"],
      trustLevel: "identity_reference" as const,
      sensitivity: "normal" as const,
    };
    expect(toolViewTier({ kind: "relationship_context_search", results: [result] })).toBe(
      "disclosure",
    );
    expect(toolViewTier({ kind: "relationship_context_search", results: [] })).toBe("line");
  });
});

describe("activeToolLabel (in-flight tool → working copy)", () => {
  it("maps known tools to present-continuous labels", () => {
    expect(activeToolLabel("search_relationship_context")).toBe("Searching your notebook…");
    expect(activeToolLabel("capture_memory")).toBe("Saving to memory…");
  });

  it("humanizes unknown tools with a trailing ellipsis", () => {
    expect(activeToolLabel("some_future_tool")).toBe("some future tool…");
  });
});
