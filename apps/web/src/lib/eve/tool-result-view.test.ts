import { describe, expect, it } from "vitest";
import { assistantToolViewKey, toAssistantToolView } from "./tool-result-view";

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
  });
});
