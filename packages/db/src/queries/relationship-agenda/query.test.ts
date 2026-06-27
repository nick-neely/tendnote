import type { Memory, SourceRecord } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createFollowupLifecycle } from "../followups/lifecycle";
import { createInMemoryRelationshipAgendaStore } from "./in-memory-store";
import { createRelationshipAgenda } from "./query";

const OWNER = "user-1";
const OTHER_OWNER = "user-2";
const WINDOW_START = new Date("2026-07-01T00:00:00Z");
const WINDOW_END = new Date("2026-07-07T23:59:59Z");

async function setup() {
  const store = createInMemoryRelationshipAgendaStore();
  const followups = createFollowupLifecycle(store);
  const agenda = createRelationshipAgenda(store);

  async function person(displayName: string, birthday: string | null, ownerUserId = OWNER) {
    return store.createPerson({
      ownerUserId,
      displayName,
      firstName: null,
      lastName: null,
      birthday,
      relationshipType: "friend",
      closenessLevel: 3,
      profileBlurb: null,
      source: "manual",
    });
  }

  return { store, followups, agenda, person };
}

function suggestedMemory(
  overrides: Partial<Memory> & Pick<Memory, "personId" | "sourceRecordId" | "content">,
): Memory {
  const now = new Date("2026-06-01T00:00:00Z");

  return {
    id: overrides.id ?? `memory-${Math.random()}`,
    ownerUserId: overrides.ownerUserId ?? OWNER,
    personId: overrides.personId,
    sourceRecordId: overrides.sourceRecordId,
    content: overrides.content,
    memoryType: overrides.memoryType ?? "context",
    status: overrides.status ?? "suggested",
    importance: overrides.importance ?? 3,
    sensitivity: overrides.sensitivity ?? "normal",
    confidence: overrides.confidence ?? "medium",
    scope: overrides.scope ?? "private",
    approvedAt: overrides.approvedAt ?? null,
    dismissedAt: overrides.dismissedAt ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

describe("relationship agenda deterministic foundation", () => {
  it("returns owner-scoped active follow-ups and birthdays as one ranked typed list", async () => {
    const { followups, agenda, person } = await setup();
    const mara = await person("Mara Lin", "1990-07-05");
    const sam = await person("Sam Rivera", "1988-07-10");
    const intruder = await person("Hidden Person", "1980-07-04", OTHER_OWNER);

    await followups.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Ask about the move.",
      dueAt: new Date("2026-06-29T12:00:00Z"),
    });
    await followups.createFollowup({
      ownerUserId: OTHER_OWNER,
      personId: intruder.id,
      reason: "Should not leak.",
      dueAt: new Date("2026-07-02T12:00:00Z"),
    });

    const result = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      limit: 10,
      directlyRequested: false,
    });

    expect(result).toMatchObject([
      {
        kind: "due_followup",
        personId: mara.id,
        personDisplayName: "Mara Lin",
        title: "Overdue follow-up for Mara Lin",
        reason: "Ask about the move.",
        trustLevel: "active_reminder",
        sensitivity: "normal",
        rank: 1,
      },
      {
        kind: "birthday",
        personId: mara.id,
        personDisplayName: "Mara Lin",
        title: "Mara Lin's birthday",
        trustLevel: "stored_profile_data",
        sensitivity: "normal",
        rank: 2,
      },
    ]);
    expect(result.map((candidate) => candidate.personId)).not.toContain(sam.id);
    expect(result.map((candidate) => candidate.personId)).not.toContain(intruder.id);
    expect(result[0]?.sourceRefs).toEqual([expect.objectContaining({ kind: "followup" })]);
    expect(result[1]?.sourceRefs).toEqual([{ kind: "person", id: mara.id }]);
  });

  it("keeps exact birthday windows precise unless the query is broad", async () => {
    const { agenda, person } = await setup();
    const casey = await person("Casey", "1990-07-12");

    await expect(
      agenda.getRelationshipAgenda({
        ownerUserId: OWNER,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        query: "anything next week?",
        includeKinds: ["birthday"],
      }),
    ).resolves.toEqual([]);

    const broad = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      query: "who deserves a thought today?",
      includeKinds: ["birthday"],
    });

    expect(broad).toEqual([
      expect.objectContaining({
        kind: "birthday",
        personId: casey.id,
        title: "Upcoming birthday for Casey",
        reason: "Birthday is outside the requested window but inside the prep buffer.",
      }),
    ]);
  });

  it("filters same-owner follow-ups by the requested window end", async () => {
    const { followups, agenda, person } = await setup();
    const mara = await person("Mara Lin", null);

    await followups.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Inside the window.",
      dueAt: new Date("2026-07-02T12:00:00Z"),
    });
    await followups.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "After the window.",
      dueAt: new Date("2026-07-12T12:00:00Z"),
    });

    const result = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      includeKinds: ["due_followup"],
    });

    expect(result).toEqual([
      expect.objectContaining({
        kind: "due_followup",
        reason: "Inside the window.",
      }),
    ]);
  });

  it("ranks due follow-ups ahead of birthday prep-buffer items in one mixed result", async () => {
    const { followups, agenda, person } = await setup();
    const mara = await person("Mara Lin", null);
    const casey = await person("Casey", "1990-07-12");

    await followups.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Ask about the move.",
      dueAt: new Date("2026-07-02T12:00:00Z"),
    });

    const result = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      query: "who deserves a thought today?",
      includeKinds: ["due_followup", "birthday"],
    });

    expect(result).toEqual([
      expect.objectContaining({
        kind: "due_followup",
        personId: mara.id,
        rank: 1,
      }),
      expect.objectContaining({
        kind: "birthday",
        personId: casey.id,
        title: "Upcoming birthday for Casey",
        rank: 2,
      }),
    ]);
  });

  it("honors kind filters and limit behavior without mutating follow-ups", async () => {
    const { store, followups, agenda, person } = await setup();
    const mara = await person("Mara Lin", "1990-07-05");
    await person("Casey", "1989-07-06");
    const followup = await followups.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Ask about the move.",
      dueAt: new Date("2026-07-02T12:00:00Z"),
    });

    const result = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      includeKinds: ["birthday"],
      limit: 1,
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("birthday");
    await expect(
      store.getFollowup({ ownerUserId: OWNER, followupId: followup.id }),
    ).resolves.toEqual(expect.objectContaining({ status: "open" }));
  });

  it("returns suggested memories, suggested follow-ups, and source-record reviews as typed review candidates", async () => {
    const { store, agenda, person } = await setup();
    const mara = await person("Mara Lin", null);
    const sourceRecord = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Mara mentioned a possible move.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    await store.linkSourceRecordPerson({
      sourceRecordId: sourceRecord.id,
      personId: mara.id,
      role: "primary",
    });
    const followup = await store.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Ask whether the move happened.",
      dueAt: new Date("2026-07-04T12:00:00Z"),
      status: "suggested",
      sourceRecordId: sourceRecord.id,
    });
    const completedFollowup = await store.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Completed suggestion should stay out.",
      dueAt: new Date("2026-07-05T12:00:00Z"),
      status: "completed",
      sourceRecordId: sourceRecord.id,
    });
    const dismissedFollowup = await store.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Dismissed suggestion should stay out.",
      dueAt: new Date("2026-07-06T12:00:00Z"),
      status: "dismissed",
      sourceRecordId: sourceRecord.id,
    });
    const archivedFollowup = await store.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Archived suggestion should stay out.",
      dueAt: new Date("2026-07-07T12:00:00Z"),
      status: "archived",
      sourceRecordId: sourceRecord.id,
    });
    store.seedSuggestedMemories([
      suggestedMemory({
        id: "memory-1",
        personId: mara.id,
        sourceRecordId: sourceRecord.id,
        content: "Mara may be moving.",
        sensitivity: "sensitive",
      }),
      suggestedMemory({
        id: "memory-dismissed",
        personId: mara.id,
        sourceRecordId: sourceRecord.id,
        content: "Dismissed context.",
        status: "dismissed",
      }),
      suggestedMemory({
        id: "memory-approved",
        personId: mara.id,
        sourceRecordId: sourceRecord.id,
        content: "Approved context.",
        status: "approved",
      }),
    ]);
    store.listSuggestedFollowupsForOwner = async () => [
      followup,
      completedFollowup,
      dismissedFollowup,
      archivedFollowup,
    ];
    store.seedSourceRecordReviews([
      { sourceRecord, linkedPeople: [{ id: mara.id, displayName: mara.displayName }] },
    ]);

    const result = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      includeKinds: ["review_item", "suggested_followup"],
    });

    expect(result).toEqual([
      expect.objectContaining({
        kind: "review_item",
        personId: mara.id,
        personDisplayName: "Mara Lin",
        title: "Review suggested memory for Mara Lin",
        reason: "Mara may be moving.",
        trustLevel: "tentative",
        sensitivity: "sensitive",
        rank: 1,
        sourceRefs: [
          { kind: "memory", id: "memory-1" },
          { kind: "source_record", id: sourceRecord.id },
        ],
      }),
      expect.objectContaining({
        kind: "suggested_followup",
        personId: mara.id,
        title: "Review suggested follow-up for Mara Lin",
        reason: "Ask whether the move happened.",
        trustLevel: "tentative",
        rank: 2,
        sourceRefs: [
          { kind: "followup", id: followup.id },
          { kind: "source_record", id: sourceRecord.id },
        ],
      }),
      expect.objectContaining({
        kind: "review_item",
        personId: mara.id,
        title: "Review logged context for Mara Lin",
        reason: "Mara mentioned a possible move.",
        trustLevel: "logged_context",
        rank: 3,
      }),
    ]);
    expect(result.map((candidate) => candidate.reason)).not.toContain("Dismissed context.");
    expect(result.map((candidate) => candidate.reason)).not.toContain("Approved context.");
    expect(result.map((candidate) => candidate.reason)).not.toContain(
      "Completed suggestion should stay out.",
    );
    expect(result.map((candidate) => candidate.reason)).not.toContain(
      "Dismissed suggestion should stay out.",
    );
    expect(result.map((candidate) => candidate.reason)).not.toContain(
      "Archived suggestion should stay out.",
    );
  });

  it("keeps personless source-record reviews lower priority and asks for resolution", async () => {
    const { store, followups, agenda, person } = await setup();
    const mara = await person("Mara Lin", null);
    const personless = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Someone from the conference mentioned a promotion.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "pending_resolution",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    await followups.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Send the article.",
      dueAt: new Date("2026-07-02T12:00:00Z"),
    });
    store.seedSourceRecordReviews([
      { sourceRecord: personless, linkedPeople: [] },
      {
        sourceRecord: {
          ...personless,
          id: "archived-source",
          status: "archived",
        } satisfies SourceRecord,
        linkedPeople: [],
      },
    ]);

    const result = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      includeKinds: ["due_followup", "review_item"],
    });

    expect(result).toEqual([
      expect.objectContaining({ kind: "due_followup", rank: 1 }),
      expect.objectContaining({
        kind: "review_item",
        personId: null,
        personDisplayName: null,
        title: "Resolve a personless source record",
        reason:
          "This source record needs person resolution before it becomes relationship context.",
        sourceRefs: [{ kind: "source_record", id: personless.id }],
        rank: 2,
      }),
    ]);
    expect(result.map((candidate) => candidate.sourceRefs[0]?.id)).not.toContain("archived-source");
  });

  it("kind filters exclude review items from deterministic agenda reads", async () => {
    const { store, agenda, person } = await setup();
    const mara = await person("Mara Lin", null);
    const sourceRecord = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Mara mentioned a possible move.",
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
        personId: mara.id,
        sourceRecordId: sourceRecord.id,
        content: "Mara may be moving.",
      }),
    ]);

    await expect(
      agenda.getRelationshipAgenda({
        ownerUserId: OWNER,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        includeKinds: ["birthday"],
      }),
    ).resolves.toEqual([]);
  });

  it("lets suggested_followup filters return only suggested follow-up review candidates", async () => {
    const { store, agenda, person } = await setup();
    const mara = await person("Mara Lin", null);
    const sourceRecord = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Mara mentioned a possible move.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    const followup = await store.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Ask whether the move happened.",
      dueAt: new Date("2026-07-04T12:00:00Z"),
      status: "suggested",
      sourceRecordId: sourceRecord.id,
    });
    store.seedSuggestedMemories([
      suggestedMemory({
        id: "memory-1",
        personId: mara.id,
        sourceRecordId: sourceRecord.id,
        content: "Mara may be moving.",
      }),
    ]);
    store.seedSourceRecordReviews([
      { sourceRecord, linkedPeople: [{ id: mara.id, displayName: mara.displayName }] },
    ]);

    const result = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      includeKinds: ["suggested_followup"],
    });

    expect(result).toEqual([
      expect.objectContaining({
        kind: "suggested_followup",
        title: "Review suggested follow-up for Mara Lin",
        reason: "Ask whether the move happened.",
        sourceRefs: [
          { kind: "followup", id: followup.id },
          { kind: "source_record", id: sourceRecord.id },
        ],
      }),
    ]);
  });

  it("keeps review_item filters separate from suggested follow-up filters", async () => {
    const { store, agenda, person } = await setup();
    const mara = await person("Mara Lin", null);
    const sourceRecord = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Mara mentioned a possible move.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    await store.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Ask whether the move happened.",
      dueAt: new Date("2026-07-04T12:00:00Z"),
      status: "suggested",
      sourceRecordId: sourceRecord.id,
    });
    store.seedSuggestedMemories([
      suggestedMemory({
        id: "memory-1",
        personId: mara.id,
        sourceRecordId: sourceRecord.id,
        content: "Mara may be moving.",
      }),
    ]);
    store.seedSourceRecordReviews([
      { sourceRecord, linkedPeople: [{ id: mara.id, displayName: mara.displayName }] },
    ]);

    const reviewOnly = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      includeKinds: ["review_item"],
    });

    expect(reviewOnly).toEqual([
      expect.objectContaining({
        kind: "review_item",
        title: "Review suggested memory for Mara Lin",
      }),
      expect.objectContaining({
        kind: "review_item",
        title: "Review logged context for Mara Lin",
      }),
    ]);
    expect(reviewOnly.map((candidate) => candidate.kind)).not.toContain("suggested_followup");
  });

  it("owner-scopes review candidates even when an adapter returns extra rows", async () => {
    const { store, agenda, person } = await setup();
    const mara = await person("Mara Lin", null);
    const intruder = await person("Hidden Person", null, OTHER_OWNER);
    const sourceRecord = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Mara mentioned a possible move.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    const otherSourceRecord = await store.createSourceRecord({
      ownerUserId: OTHER_OWNER,
      sourceType: "manual",
      content: "Should not leak.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    const otherFollowup = await store.createFollowup({
      ownerUserId: OTHER_OWNER,
      personId: intruder.id,
      reason: "Should not leak.",
      dueAt: new Date("2026-07-04T12:00:00Z"),
      status: "suggested",
      sourceRecordId: otherSourceRecord.id,
    });
    store.listSuggestedMemoriesForOwner = async () => [
      suggestedMemory({
        id: "memory-1",
        personId: mara.id,
        sourceRecordId: sourceRecord.id,
        content: "Mara may be moving.",
      }),
      suggestedMemory({
        id: "memory-other-owner",
        ownerUserId: OTHER_OWNER,
        personId: intruder.id,
        sourceRecordId: otherSourceRecord.id,
        content: "Should not leak.",
      }),
    ];
    store.listSuggestedFollowupsForOwner = async () => [otherFollowup];
    store.listSourceRecordReviewsForOwner = async () => [
      {
        sourceRecord: otherSourceRecord,
        linkedPeople: [{ id: intruder.id, displayName: intruder.displayName }],
      },
    ];

    const result = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      includeKinds: ["review_item"],
    });

    expect(result).toEqual([
      expect.objectContaining({
        kind: "review_item",
        personId: mara.id,
        reason: "Mara may be moving.",
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("Should not leak");
    expect(JSON.stringify(result)).not.toContain("memory-other-owner");
  });

  it("includes capped recent context by default from active person-linked non-restricted source records", async () => {
    const { store, agenda, person } = await setup();
    const mara = await person("Mara Lin", null);
    const sam = await person("Sam Rivera", null);
    const recentRows: Array<{
      id: string;
      content: string;
      personId: string;
      sensitivity: "normal" | "sensitive" | "restricted";
    }> = [
      {
        id: "recent-1",
        content: "Mara logged a recent move update.",
        personId: mara.id,
        sensitivity: "normal",
      },
      {
        id: "recent-2",
        content: "Sam mentioned a job change.",
        personId: sam.id,
        sensitivity: "normal",
      },
      {
        id: "recent-3",
        content: "Mara shared a birthday plan.",
        personId: mara.id,
        sensitivity: "sensitive",
      },
      {
        id: "recent-4",
        content: "Fourth eligible context should stay out.",
        personId: sam.id,
        sensitivity: "normal",
      },
      {
        id: "recent-5",
        content: "Restricted context should stay out.",
        personId: mara.id,
        sensitivity: "restricted",
      },
    ];
    const records = await Promise.all(
      recentRows.map(async ({ id, content, personId, sensitivity }, index) => {
        const sourceRecord = await store.createSourceRecord({
          ownerUserId: OWNER,
          sourceType: "manual",
          content,
          rawContent: null,
          retentionPolicy: "retain",
          status: "active",
          confidence: "medium",
          sensitivity,
          scope: "private",
          importance: 3,
          metadataJson: {},
        });
        await store.linkSourceRecordPerson({
          sourceRecordId: sourceRecord.id,
          personId,
          role: "primary",
        });

        return {
          sourceRecord: {
            ...sourceRecord,
            id,
            createdAt: new Date(`2026-06-0${index + 1}T00:00:00Z`),
          },
          linkedPeople: [
            {
              id: personId,
              displayName: personId === mara.id ? mara.displayName : sam.displayName,
            },
          ],
        };
      }),
    );
    store.seedRecentSourceRecords(records);

    const result = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });

    expect(result).toEqual([
      expect.objectContaining({
        kind: "recent_context",
        personId: mara.id,
        personDisplayName: "Mara Lin",
        title: "Recent logged context for Mara Lin",
        reason: "Mara logged a recent move update.",
        trustLevel: "logged_context",
        sensitivity: "normal",
        rank: 1,
      }),
      expect.objectContaining({
        kind: "recent_context",
        personId: sam.id,
        reason: "Sam mentioned a job change.",
        rank: 2,
      }),
      expect.objectContaining({
        kind: "recent_context",
        personId: mara.id,
        reason: "Mara shared a birthday plan.",
        sensitivity: "sensitive",
        rank: 3,
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("Restricted context should stay out.");
    expect(JSON.stringify(result)).not.toContain("Fourth eligible context should stay out.");
  });

  it("ranks recent context below concrete agenda items and honors recent_context filters", async () => {
    const { store, followups, agenda, person } = await setup();
    const mara = await person("Mara Lin", "1990-07-05");
    const reviewSourceRecord = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Mara has pending logged context to review.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "pending_resolution",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
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
    await followups.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Ask about the move.",
      dueAt: new Date("2026-07-02T12:00:00Z"),
    });
    store.seedRecentSourceRecords([
      {
        sourceRecord,
        linkedPeople: [{ id: mara.id, displayName: mara.displayName }],
      },
    ]);
    store.seedSourceRecordReviews([{ sourceRecord: reviewSourceRecord, linkedPeople: [] }]);

    const mixed = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });

    expect(mixed.map((candidate) => candidate.kind)).toEqual([
      "due_followup",
      "birthday",
      "review_item",
      "recent_context",
    ]);

    const recentOnly = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      includeKinds: ["recent_context"],
    });

    expect(recentOnly).toEqual([
      expect.objectContaining({
        kind: "recent_context",
        reason: "Mara shared a recent update.",
        rank: 1,
      }),
    ]);

    await expect(
      agenda.getRelationshipAgenda({
        ownerUserId: OWNER,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        includeKinds: ["due_followup"],
      }),
    ).resolves.toEqual([expect.objectContaining({ kind: "due_followup" })]);
  });

  it("excludes personless, non-active, restricted, unclear-recency, and other-owner recent context", async () => {
    const { store, agenda, person } = await setup();
    const mara = await person("Mara Lin", null);
    const intruder = await person("Hidden Person", null, OTHER_OWNER);
    const eligible = await store.createSourceRecord({
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
    const personless = {
      ...eligible,
      id: "personless-recent",
      content: "Personless should stay out.",
    };
    const dismissed = {
      ...eligible,
      id: "dismissed-recent",
      content: "Dismissed should stay out.",
      status: "dismissed" as const,
    };
    const archived = {
      ...eligible,
      id: "archived-recent",
      content: "Archived should stay out.",
      status: "archived" as const,
    };
    const pendingResolution = {
      ...eligible,
      id: "pending-recent",
      content: "Pending resolution should stay out.",
      status: "pending_resolution" as const,
    };
    const restricted = {
      ...eligible,
      id: "restricted-recent",
      content: "Restricted should stay out.",
      sensitivity: "restricted" as const,
    };
    const unclearRecency = {
      ...eligible,
      id: "unclear-recency",
      content: "Unclear recency should stay out.",
      createdAt: new Date("not a date"),
    };
    const otherOwner = {
      ...eligible,
      id: "other-owner-recent",
      ownerUserId: OTHER_OWNER,
      content: "Other owner should stay out.",
    };
    store.seedRecentSourceRecords([
      { sourceRecord: eligible, linkedPeople: [{ id: mara.id, displayName: mara.displayName }] },
      { sourceRecord: personless, linkedPeople: [] },
      { sourceRecord: dismissed, linkedPeople: [{ id: mara.id, displayName: mara.displayName }] },
      { sourceRecord: archived, linkedPeople: [{ id: mara.id, displayName: mara.displayName }] },
      {
        sourceRecord: pendingResolution,
        linkedPeople: [{ id: mara.id, displayName: mara.displayName }],
      },
      { sourceRecord: restricted, linkedPeople: [{ id: mara.id, displayName: mara.displayName }] },
      {
        sourceRecord: unclearRecency,
        linkedPeople: [{ id: mara.id, displayName: mara.displayName }],
      },
      {
        sourceRecord: otherOwner,
        linkedPeople: [{ id: intruder.id, displayName: intruder.displayName }],
      },
    ]);

    const result = await agenda.getRelationshipAgenda({
      ownerUserId: OWNER,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      includeKinds: ["recent_context"],
    });

    expect(result).toEqual([
      expect.objectContaining({
        kind: "recent_context",
        reason: "Mara shared a recent update.",
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("Personless should stay out.");
    expect(JSON.stringify(result)).not.toContain("Dismissed should stay out.");
    expect(JSON.stringify(result)).not.toContain("Archived should stay out.");
    expect(JSON.stringify(result)).not.toContain("Pending resolution should stay out.");
    expect(JSON.stringify(result)).not.toContain("Restricted should stay out.");
    expect(JSON.stringify(result)).not.toContain("Unclear recency should stay out.");
    expect(JSON.stringify(result)).not.toContain("Other owner should stay out.");
  });

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
