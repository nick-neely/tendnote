import { describe, expect, it } from "vitest";
import {
  OTHER_OWNER,
  OWNER,
  setup,
  suggestedMemory,
  WINDOW_END,
  WINDOW_START,
} from "./query.test-helpers";

describe("relationship agenda — semantic context", () => {
  it("adds semantic context candidates when a query is present", async () => {
    const { store, agenda } = await setup();
    store.seedSemanticResults(OWNER, [
      {
        recordKind: "memory",
        recordId: "memory-1",
        relatedPersonId: "person-1",
        relatedPersonDisplayName: "Mara Lin",
        snippet: "Mara likes practical kitchen gifts.",
        similarity: 0.91,
        trustLevel: "confirmed_fact",
        sensitivity: "normal",
        sourceRefs: [{ kind: "memory", id: "memory-1" }],
        routing: { personId: "person-1", recordKind: "memory", recordId: "memory-1" },
      },
      {
        recordKind: "source_record",
        recordId: "source-1",
        relatedPersonId: "person-2",
        relatedPersonDisplayName: "Sam Rivera",
        snippet: "You logged that Sam may be changing jobs.",
        similarity: 0.84,
        trustLevel: "logged_context",
        sensitivity: "sensitive",
        sourceRefs: [{ kind: "source_record", id: "source-1" }],
        routing: { personId: "person-2", recordKind: "source_record", recordId: "source-1" },
      },
    ]);

    const result = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      query: "gift ideas and career updates",
      includeKinds: ["semantic_context"],
    });

    expect(result).toEqual([
      expect.objectContaining({
        kind: "semantic_context",
        personId: "person-1",
        personDisplayName: "Mara Lin",
        title: "Related context for Mara Lin",
        reason: "Mara likes practical kitchen gifts.",
        sourceRefs: [{ kind: "memory", id: "memory-1" }],
        trustLevel: "confirmed_fact",
        sensitivity: "normal",
        rank: 1,
      }),
      expect.objectContaining({
        kind: "semantic_context",
        personId: "person-2",
        personDisplayName: "Sam Rivera",
        reason: "You logged that Sam may be changing jobs.",
        sourceRefs: [{ kind: "source_record", id: "source-1" }],
        trustLevel: "logged_context",
        sensitivity: "sensitive",
        rank: 2,
      }),
    ]);
    expect(store.listSemanticSearchInputs()).toEqual([
      {
        ownerUserId: OWNER,
        query: "gift ideas and career updates",
        limit: 3,
        directlyRequested: false,
      },
    ]);
  });

  it("owner-scopes semantic agenda matches", async () => {
    const { store, agenda } = await setup();
    store.seedSemanticResults(OTHER_OWNER, [
      {
        recordKind: "memory",
        recordId: "memory-other",
        relatedPersonId: "person-other",
        relatedPersonDisplayName: "Hidden Person",
        snippet: "Should not leak.",
        similarity: 0.91,
        trustLevel: "confirmed_fact",
        sensitivity: "normal",
        sourceRefs: [{ kind: "memory", id: "memory-other" }],
        routing: { personId: "person-other", recordKind: "memory", recordId: "memory-other" },
      },
    ]);

    const result = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      query: "gift ideas",
      includeKinds: ["semantic_context"],
    });

    expect(result).toEqual([]);
  });

  it("lets concrete review candidates win over overlapping semantic matches while keeping source grounding", async () => {
    const { store, agenda, person } = await setup();
    const mara = await person("Mara Lin", null);
    const sourceRecord = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Mara may be moving.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    store.seedSuggestedMemories([
      suggestedMemory({
        id: "memory-1",
        personId: mara.id,
        sourceRecordId: sourceRecord.id,
        content: "Mara may be moving.",
      }),
    ]);
    store.seedSemanticResults(OWNER, [
      {
        recordKind: "memory",
        recordId: "memory-1",
        relatedPersonId: mara.id,
        relatedPersonDisplayName: mara.displayName,
        snippet: "Mara may be moving.",
        similarity: 0.91,
        trustLevel: "confirmed_fact",
        sensitivity: "normal",
        sourceRefs: [{ kind: "memory", id: "memory-1" }],
        routing: { personId: mara.id, recordKind: "memory", recordId: "memory-1" },
      },
      {
        recordKind: "source_record",
        recordId: "source-semantic",
        relatedPersonId: mara.id,
        relatedPersonDisplayName: mara.displayName,
        snippet: "Mara may be moving soon.",
        similarity: 0.89,
        trustLevel: "logged_context",
        sensitivity: "normal",
        sourceRefs: [{ kind: "source_record", id: "source-semantic" }],
        routing: { personId: mara.id, recordKind: "source_record", recordId: "source-semantic" },
      },
    ]);

    const result = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      query: "move",
      includeKinds: ["review_item", "semantic_context"],
    });

    expect(result).toEqual([
      expect.objectContaining({
        kind: "review_item",
        sourceRefs: [
          { kind: "memory", id: "memory-1" },
          { kind: "source_record", id: sourceRecord.id },
          { kind: "source_record", id: "source-semantic" },
        ],
      }),
    ]);
  });

  it("dedupes semantic matches by materially identical reason even without shared source refs", async () => {
    const { store, agenda } = await setup();
    store.seedSemanticResults(OWNER, [
      {
        recordKind: "source_record",
        recordId: "source-1",
        relatedPersonId: "person-1",
        relatedPersonDisplayName: "Mara Lin",
        snippet: "Mara may be moving to Seattle soon.",
        similarity: 0.91,
        trustLevel: "logged_context",
        sensitivity: "normal",
        sourceRefs: [{ kind: "source_record", id: "source-1" }],
        routing: { personId: "person-1", recordKind: "source_record", recordId: "source-1" },
      },
      {
        recordKind: "source_record",
        recordId: "source-2",
        relatedPersonId: "person-2",
        relatedPersonDisplayName: "Sam Rivera",
        snippet: "You logged that Mara may be moving to Seattle soon.",
        similarity: 0.86,
        trustLevel: "logged_context",
        sensitivity: "normal",
        sourceRefs: [{ kind: "source_record", id: "source-2" }],
        routing: { personId: "person-2", recordKind: "source_record", recordId: "source-2" },
      },
    ]);

    const result = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      query: "moving to Seattle",
      includeKinds: ["semantic_context"],
    });

    expect(result).toEqual([
      expect.objectContaining({
        kind: "semantic_context",
        personId: "person-1",
        sourceRefs: [
          { kind: "source_record", id: "source-1" },
          { kind: "source_record", id: "source-2" },
        ],
      }),
    ]);
  });

  it("omits semantic context without a query and honors semantic_context filters", async () => {
    const { store, agenda, person } = await setup();
    const mara = await person("Mara Lin", "1990-07-05");
    store.seedSemanticResults(OWNER, [
      {
        recordKind: "memory",
        recordId: "memory-1",
        relatedPersonId: mara.id,
        relatedPersonDisplayName: mara.displayName,
        snippet: "Mara likes practical kitchen gifts.",
        similarity: 0.91,
        trustLevel: "confirmed_fact",
        sensitivity: "normal",
        sourceRefs: [{ kind: "memory", id: "memory-1" }],
        routing: { personId: mara.id, recordKind: "memory", recordId: "memory-1" },
      },
    ]);

    const sourceRecord = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Mara shared a recent update.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    store.seedRecentSourceRecords([
      {
        sourceRecord,
        linkedPeople: [{ id: mara.id, displayName: mara.displayName }],
      },
    ]);

    const withoutQuery = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });

    expect(withoutQuery.map((candidate) => candidate.kind)).toEqual(["birthday", "recent_context"]);

    const birthdayOnly = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      query: "gift ideas",
      includeKinds: ["birthday"],
    });

    expect(birthdayOnly.map((candidate) => candidate.kind)).toEqual(["birthday"]);
  });

  it.each([
    "missing embeddings",
    "stale embeddings",
    "processing embeddings",
    "failed embeddings",
    "unavailable embeddings",
  ])("fails open when semantic retrieval has %s", async (failure) => {
    const { store, followups, agenda, person } = await setup();
    const mara = await person("Mara Lin", null);
    await followups.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Ask about the move.",
      dueAt: new Date("2026-07-02T12:00:00Z"),
    });
    store.failSemanticSearch(new Error(failure));

    const result = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      query: "career updates",
      includeKinds: ["due_followup", "semantic_context"],
    });

    expect(result).toEqual([
      expect.objectContaining({
        kind: "due_followup",
        reason: "Ask about the move.",
        rank: 1,
      }),
    ]);
  });

  it("excludes restricted semantic context unless directly requested with sensitive query intent", async () => {
    const { store, agenda } = await setup();
    store.seedSemanticResults(OWNER, [
      {
        recordKind: "source_record",
        recordId: "source-restricted",
        relatedPersonId: "person-1",
        relatedPersonDisplayName: "Mara Lin",
        snippet: "Restricted context.",
        similarity: 0.91,
        trustLevel: "logged_context",
        sensitivity: "restricted",
        sourceRefs: [{ kind: "source_record", id: "source-restricted" }],
        routing: {
          personId: "person-1",
          recordKind: "source_record",
          recordId: "source-restricted",
        },
      },
    ]);

    await expect(
      agenda.getRelationshipAgenda({
        ownerUserId: OWNER,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        query: "delicate topic",
        includeKinds: ["semantic_context"],
      }),
    ).resolves.toEqual([]);

    await expect(
      agenda.getRelationshipAgenda({
        ownerUserId: OWNER,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        query: "relationship context",
        includeKinds: ["semantic_context"],
        directlyRequested: true,
      }),
    ).resolves.toEqual([]);

    await expect(
      agenda.getRelationshipAgenda({
        ownerUserId: OWNER,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        query: "show the sensitive context for Mara",
        includeKinds: ["semantic_context"],
        directlyRequested: true,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        kind: "semantic_context",
        title: "Restricted related context for Mara Lin",
        sensitivity: "restricted",
        sourceRefs: [{ kind: "source_record", id: "source-restricted" }],
      }),
    ]);
  });
});
