import type { SourceRecord } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createHouseholdLifecycle } from "../households/lifecycle";
import {
  OTHER_OWNER,
  OWNER,
  setup,
  suggestedMemory,
  WINDOW_END,
  WINDOW_START,
} from "./query.test-helpers";

describe("relationship agenda — review candidates", () => {
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

  it("includes selected-member visible review candidates without leaking private review items", async () => {
    const { store, agenda, person } = await setup();
    const households = createHouseholdLifecycle(store);
    const memberUserId = "user-3";
    const { household } = await households.createHousehold({ ownerUserId: OWNER, name: "Home" });
    await households.inviteMember({
      ownerUserId: OWNER,
      householdId: household.id,
      invitedUserId: memberUserId,
    });
    await households.acceptInvite({ householdId: household.id, userId: memberUserId });
    const mara = await person("Mara Lin", null);
    const sharedSource = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Mara shared context for review.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "pending_resolution",
      confidence: "medium",
      sensitivity: "normal",
      scope: "shared",
      householdId: household.id,
      importance: 3,
      metadataJson: {},
    });
    await store.createHouseholdRecordShare({
      householdId: household.id,
      recordKind: "source_record",
      recordId: sharedSource.id,
      sharedWithUserId: memberUserId,
      sharedByUserId: OWNER,
    });
    const privateSource = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Private review source should not leak.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "pending_resolution",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    const sharedFollowup = await store.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Shared suggested follow-up.",
      dueAt: new Date("2026-07-04T12:00:00Z"),
      householdId: household.id,
      scope: "shared",
      sourceRecordId: sharedSource.id,
      status: "suggested",
    });
    await store.createHouseholdRecordShare({
      householdId: household.id,
      recordKind: "followup",
      recordId: sharedFollowup.id,
      sharedWithUserId: memberUserId,
      sharedByUserId: OWNER,
    });
    await store.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Private suggested follow-up should not leak.",
      dueAt: new Date("2026-07-04T12:00:00Z"),
      sourceRecordId: privateSource.id,
      status: "suggested",
    });
    store.seedSuggestedMemories([
      suggestedMemory({
        id: "shared-memory",
        ownerUserId: OWNER,
        personId: mara.id,
        sourceRecordId: sharedSource.id,
        content: "Shared suggested memory.",
        scope: "shared",
        householdId: household.id,
      }),
      suggestedMemory({
        id: "private-memory",
        ownerUserId: OWNER,
        personId: mara.id,
        sourceRecordId: privateSource.id,
        content: "Private suggested memory should not leak.",
      }),
    ]);
    await store.createHouseholdRecordShare({
      householdId: household.id,
      recordKind: "memory",
      recordId: "shared-memory",
      sharedWithUserId: memberUserId,
      sharedByUserId: OWNER,
    });
    store.seedSourceRecordReviews([
      {
        sourceRecord: sharedSource,
        linkedPeople: [{ id: mara.id, displayName: mara.displayName }],
      },
      {
        sourceRecord: privateSource,
        linkedPeople: [{ id: mara.id, displayName: mara.displayName }],
      },
    ]);

    const result = await agenda.getRelationshipAgenda({
      ownerUserId: memberUserId,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      includeKinds: ["review_item", "suggested_followup"],
    });

    expect(result).toEqual([
      expect.objectContaining({
        kind: "review_item",
        reason: "Shared suggested memory.",
        visibilityChoice: "selected_members",
        visibilityLabel: "Specific people",
      }),
      expect.objectContaining({
        kind: "suggested_followup",
        reason: "Shared suggested follow-up.",
        visibilityChoice: "selected_members",
        visibilityLabel: "Specific people",
      }),
      expect.objectContaining({
        kind: "review_item",
        reason: "Mara shared context for review.",
        visibilityChoice: "selected_members",
        visibilityLabel: "Specific people",
      }),
    ]);
    expect(result.map((candidate) => candidate.reason)).not.toContain(
      "Private suggested memory should not leak.",
    );
    expect(result.map((candidate) => candidate.reason)).not.toContain(
      "Private suggested follow-up should not leak.",
    );
    expect(result.map((candidate) => candidate.reason)).not.toContain(
      "Private review source should not leak.",
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
    await store.createFollowup({
      ownerUserId: OTHER_OWNER,
      personId: intruder.id,
      reason: "Should not leak.",
      dueAt: new Date("2026-07-04T12:00:00Z"),
      status: "suggested",
      sourceRecordId: otherSourceRecord.id,
    });
    store.seedSuggestedMemories([
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
    ]);
    store.seedSourceRecordReviews([
      {
        sourceRecord: otherSourceRecord,
        linkedPeople: [{ id: intruder.id, displayName: intruder.displayName }],
      },
    ]);

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
});
