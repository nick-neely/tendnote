import { describe, expect, it } from "vitest";
import {
  activeToolLabel,
  assistantToolViewKey,
  relationshipAgendaCandidateKey,
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
        person: { id: "person-1", displayName: "Mark" },
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
      personId: "person-1",
      personName: "Mark",
    });
  });

  it("maps a list_suggested_memory_reviews result into one review item per suggestion", () => {
    const view = toAssistantToolView({
      toolName: "list_suggested_memory_reviews",
      output: {
        found: true,
        personId: "person-1",
        count: 2,
        reviews: [
          {
            person: { id: "person-1", displayName: "Juli" },
            memory: { id: "m1", content: "Girls night next week.", sourceRecordId: "s1" },
          },
          {
            person: { id: "person-2", displayName: "Mark" },
            memory: { id: "m2", content: "New manager at work.", sourceRecordId: null },
          },
        ],
      },
    });

    expect(view).toEqual({
      kind: "suggested_memory_review_list",
      reviews: [
        {
          memoryId: "m1",
          content: "Girls night next week.",
          sourceRecordId: "s1",
          personId: "person-1",
          personName: "Juli",
        },
        {
          memoryId: "m2",
          content: "New manager at work.",
          sourceRecordId: null,
          personId: "person-2",
          personName: "Mark",
        },
      ],
    });
  });

  // Computed with the same formatter so the assertion is timezone-independent.
  const dueLabel = new Date("2026-07-15T00:00:00.000Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  it("renders a get_suggested_followup_review result as a tentative follow-up item", () => {
    const view = toAssistantToolView({
      toolName: "get_suggested_followup_review",
      output: {
        found: true,
        component: { type: "suggested_followup_review", followupId: "f1", sourceRecordId: "s1" },
        person: { id: "person-1", displayName: "Mark" },
        followup: {
          id: "f1",
          personId: "person-1",
          reason: "Check in about the new job.",
          dueAt: "2026-07-15T00:00:00.000Z",
        },
        sourceRecord: { id: "s1" },
      },
    });

    expect(view).toEqual({
      kind: "suggested_followup_review",
      followupId: "f1",
      reason: "Check in about the new job.",
      dueLabel,
      sourceRecordId: "s1",
      personId: "person-1",
      personName: "Mark",
    });
  });

  it("renders a propose_followup result as a tentative follow-up review item", () => {
    const view = toAssistantToolView({
      toolName: "propose_followup",
      output: {
        found: true,
        component: { type: "suggested_followup_review", followupId: "f9", sourceRecordId: "s9" },
        person: { id: "person-1", displayName: "Mark" },
        followup: {
          id: "f9",
          personId: "person-1",
          reason: "Ask how the move went.",
          dueAt: "2026-07-15T00:00:00.000Z",
        },
        sourceRecord: { id: "s9" },
      },
    });

    expect(view).toEqual({
      kind: "suggested_followup_review",
      followupId: "f9",
      reason: "Ask how the move went.",
      dueLabel,
      sourceRecordId: "s9",
      personId: "person-1",
      personName: "Mark",
    });
  });

  it("maps a list_suggested_followup_reviews result into one item per suggestion", () => {
    const view = toAssistantToolView({
      toolName: "list_suggested_followup_reviews",
      output: {
        found: true,
        reviews: [
          {
            person: { id: "person-1", displayName: "Mark" },
            followup: { id: "f1", reason: "Reconnect.", dueAt: "2026-07-15T00:00:00.000Z" },
            sourceRecord: { id: "s1" },
          },
        ],
      },
    });

    expect(view).toEqual({
      kind: "suggested_followup_review_list",
      reviews: [
        {
          followupId: "f1",
          reason: "Reconnect.",
          dueLabel,
          sourceRecordId: "s1",
          personId: "person-1",
          personName: "Mark",
        },
      ],
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

  it("renders semantic recall results as compact grounded references", () => {
    const view = toAssistantToolView({
      toolName: "search_semantic_context",
      output: {
        results: [
          {
            recordKind: "source_record",
            recordId: "source-1",
            relatedPersonId: "person-1",
            relatedPersonDisplayName: "Mara Lin",
            snippet: "Mara mentioned a possible career change.",
            similarity: 0.89,
            trustLevel: "logged_context",
            sensitivity: "sensitive",
            sourceRefs: [{ kind: "source_record", id: "source-1" }],
            routing: { personId: "person-1", recordKind: "source_record", recordId: "source-1" },
            generatedAnswer: "Do not render this.",
          },
        ],
      },
    });

    expect(view).toEqual({
      kind: "semantic_context_search",
      results: [
        {
          recordKind: "source_record",
          recordId: "source-1",
          relatedPersonId: "person-1",
          relatedPersonDisplayName: "Mara Lin",
          snippet: "Mara mentioned a possible career change.",
          similarity: 0.89,
          trustLevel: "logged_context",
          sensitivity: "sensitive",
        },
      ],
    });
    expect(JSON.stringify(view)).not.toContain("generatedAnswer");
  });

  it("renders relationship agenda results as compact typed candidates", () => {
    const view = toAssistantToolView({
      toolName: "get_relationship_agenda",
      output: {
        candidates: [
          {
            kind: "due_followup",
            personId: "person-1",
            personDisplayName: "Mara Lin",
            title: "Follow up with Mara Lin",
            reason: "Ask about the move.",
            dueAt: "2026-07-02T12:00:00.000Z",
            sourceRefs: [{ kind: "followup", id: "followup-1" }],
            trustLevel: "active_reminder",
            sensitivity: "normal",
            rank: 1,
          },
          {
            kind: "suggested_followup",
            personId: "person-1",
            personDisplayName: "Mara Lin",
            title: "Review suggested follow-up for Mara Lin",
            reason: "Ask whether the move happened.",
            dueAt: "2026-07-04T12:00:00.000Z",
            sourceRefs: [
              { kind: "followup", id: "followup-2" },
              { kind: "source_record", id: "source-1" },
            ],
            trustLevel: "tentative",
            sensitivity: "sensitive",
            rank: 2,
          },
        ],
        component: { type: "relationship_agenda", resultCount: 2 },
      },
    });

    const dueLabel = new Date("2026-07-02T12:00:00.000Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    expect(view).toEqual({
      kind: "relationship_agenda",
      candidates: [
        {
          kind: "due_followup",
          personId: "person-1",
          personDisplayName: "Mara Lin",
          title: "Follow up with Mara Lin",
          reason: "Ask about the move.",
          dueAt: "2026-07-02T12:00:00.000Z",
          dueLabel,
          sourceRefs: [{ kind: "followup", id: "followup-1" }],
          trustLevel: "active_reminder",
          sensitivity: "normal",
          rank: 1,
        },
        expect.objectContaining({
          kind: "suggested_followup",
          personDisplayName: "Mara Lin",
          trustLevel: "tentative",
          sensitivity: "sensitive",
        }),
      ],
      window: null,
    });
  });

  it("echoes the requested agenda window so the calendar can highlight it", () => {
    const view = toAssistantToolView({
      toolName: "get_relationship_agenda",
      output: {
        candidates: [],
        window: { start: "2026-07-01T00:00:00Z", end: "2026-07-07T23:59:59Z" },
        component: { type: "relationship_agenda", resultCount: 0 },
      },
    });

    expect(view).toEqual({
      kind: "relationship_agenda",
      candidates: [],
      window: { start: "2026-07-01T00:00:00Z", end: "2026-07-07T23:59:59Z" },
    });
  });

  it("renders empty relationship agenda results as an empty agenda view", () => {
    const view = toAssistantToolView({
      toolName: "get_relationship_agenda",
      output: { candidates: [], component: { type: "relationship_agenda", resultCount: 0 } },
    });

    expect(view).toEqual({ kind: "relationship_agenda", candidates: [], window: null });
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
    expect(
      assistantToolViewKey({
        kind: "semantic_context_search",
        results: [
          {
            recordKind: "memory",
            recordId: "memory-1",
            relatedPersonId: "person-1",
            relatedPersonDisplayName: "Mara Lin",
            snippet: "x",
            similarity: 0.8,
            trustLevel: "confirmed_fact",
            sensitivity: "normal",
          },
        ],
      }),
    ).toBe("semantic-search:memory-1");
    expect(
      assistantToolViewKey({
        kind: "relationship_agenda",
        candidates: [
          {
            kind: "due_followup",
            personId: "person-1",
            personDisplayName: "Mara Lin",
            title: "Follow up with Mara Lin",
            reason: "Ask about the move.",
            dueAt: "2026-07-02T12:00:00.000Z",
            dueLabel: "Jul 2, 2026",
            sourceRefs: [{ kind: "followup", id: "followup-1" }],
            trustLevel: "active_reminder",
            sensitivity: "normal",
            rank: 1,
          },
        ],
      }),
    ).toBe("agenda:followup:followup-1");
    expect(
      relationshipAgendaCandidateKey({
        kind: "recent_context",
        personId: "person-1",
        personDisplayName: "Mara Lin",
        title: "Recent logged context for Mara Lin",
        reason: "Mara shared a recent update.",
        dueAt: "2026-06-25T12:00:00.000Z",
        dueLabel: "Jun 25, 2026",
        sourceRefs: [],
        trustLevel: "logged_context",
        sensitivity: "normal",
        rank: 3,
      }),
    ).toBe("recent_context:3:person-1");
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
        personId: null,
        personName: null,
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
    expect(
      toolViewTier({
        kind: "semantic_context_search",
        results: [
          {
            recordKind: "memory",
            recordId: "m1",
            relatedPersonId: null,
            relatedPersonDisplayName: null,
            snippet: "x",
            similarity: 0.8,
            trustLevel: "confirmed_fact",
            sensitivity: "normal",
          },
        ],
      }),
    ).toBe("disclosure");
    expect(toolViewTier({ kind: "semantic_context_search", results: [] })).toBe("line");
    expect(
      toolViewTier({
        kind: "relationship_agenda",
        candidates: [
          {
            kind: "birthday",
            personId: "p1",
            personDisplayName: "Alex",
            title: "Alex's birthday",
            reason: "Birthday falls inside the requested window.",
            dueAt: "2026-07-05T00:00:00.000Z",
            dueLabel: "Jul 5, 2026",
            sourceRefs: [{ kind: "person", id: "p1" }],
            trustLevel: "stored_profile_data",
            sensitivity: "normal",
            rank: 1,
          },
        ],
      }),
    ).toBe("disclosure");
    expect(toolViewTier({ kind: "relationship_agenda", candidates: [] })).toBe("line");
  });
});

describe("activeToolLabel (in-flight tool → working copy)", () => {
  it("maps known tools to present-continuous labels", () => {
    expect(activeToolLabel("search_relationship_context")).toBe("Searching your notebook…");
    expect(activeToolLabel("search_semantic_context")).toBe("Searching by meaning…");
    expect(activeToolLabel("get_relationship_agenda")).toBe("Checking your relationship agenda…");
    expect(activeToolLabel("capture_memory")).toBe("Saving to memory…");
  });

  it("humanizes unknown tools with a trailing ellipsis", () => {
    expect(activeToolLabel("some_future_tool")).toBe("some future tool…");
  });
});
