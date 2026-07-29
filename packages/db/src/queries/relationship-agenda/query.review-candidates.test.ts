import type { SourceRecord } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import {
  OTHER_OWNER,
  OWNER,
  setup,
  setupWithHouseholdMember,
  suggestedMemory,
  WINDOW_END,
  WINDOW_START,
} from "./query.test-helpers";

/**
 * One active note that has already produced both kinds of review work: a suggested
 * memory and a suggested follow-up.
 *
 * The `includeKinds` cases below share this arrangement because a filter is only
 * proven to separate the two kinds when both are present to be separated - each
 * still spells out its own read and its own assertions.
 */
async function bothReviewKindsFromOneNote() {
  const { store, agenda, person, sourceRecord } = await setup();
  const mara = await person("Mara Lin", null);
  const moveNote = await sourceRecord({ content: "Mara mentioned a possible move." });
  const followup = await store.createFollowup({
    ownerUserId: OWNER,
    personId: mara.id,
    reason: "Ask whether the move happened.",
    dueAt: new Date("2026-07-04T12:00:00Z"),
    status: "suggested",
    sourceRecordId: moveNote.id,
  });
  store.seedSuggestedMemories([
    suggestedMemory({
      id: "memory-1",
      personId: mara.id,
      sourceRecordId: moveNote.id,
      content: "Mara may be moving.",
    }),
  ]);
  store.seedSourceRecordReviews([
    { sourceRecord: moveNote, linkedPeople: [{ id: mara.id, displayName: mara.displayName }] },
  ]);

  return { agenda, moveNote, followup };
}

describe("relationship agenda — review candidates", () => {
  it("returns suggested memories and suggested follow-ups as typed review candidates, leaving filed context alone", async () => {
    const { store, agenda, person, sourceRecord } = await setup();
    const mara = await person("Mara Lin", null);
    const moveNote = await sourceRecord({ content: "Mara mentioned a possible move." });
    await store.linkSourceRecordPerson({
      sourceRecordId: moveNote.id,
      personId: mara.id,
      role: "primary",
    });
    const followup = await store.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Ask whether the move happened.",
      dueAt: new Date("2026-07-04T12:00:00Z"),
      status: "suggested",
      sourceRecordId: moveNote.id,
    });
    const completedFollowup = await store.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Completed suggestion should stay out.",
      dueAt: new Date("2026-07-05T12:00:00Z"),
      status: "completed",
      sourceRecordId: moveNote.id,
    });
    const dismissedFollowup = await store.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Dismissed suggestion should stay out.",
      dueAt: new Date("2026-07-06T12:00:00Z"),
      status: "dismissed",
      sourceRecordId: moveNote.id,
    });
    const archivedFollowup = await store.createFollowup({
      ownerUserId: OWNER,
      personId: mara.id,
      reason: "Archived suggestion should stay out.",
      dueAt: new Date("2026-07-07T12:00:00Z"),
      status: "archived",
      sourceRecordId: moveNote.id,
    });
    store.seedSuggestedMemories([
      suggestedMemory({
        id: "memory-1",
        personId: mara.id,
        sourceRecordId: moveNote.id,
        content: "Mara may be moving.",
        sensitivity: "sensitive",
      }),
      suggestedMemory({
        id: "memory-dismissed",
        personId: mara.id,
        sourceRecordId: moveNote.id,
        content: "Dismissed context.",
        status: "dismissed",
      }),
      suggestedMemory({
        id: "memory-approved",
        personId: mara.id,
        sourceRecordId: moveNote.id,
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
      { sourceRecord: moveNote, linkedPeople: [{ id: mara.id, displayName: mara.displayName }] },
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
          { kind: "source_record", id: moveNote.id },
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
          { kind: "source_record", id: moveNote.id },
        ],
      }),
    ]);
    // Plain active logged context is filed, not pending: it never becomes a review chore.
    expect(result.map((candidate) => candidate.reason)).not.toContain(
      "Mara mentioned a possible move.",
    );
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
    const { store, agenda, person, sourceRecord, household, memberUserId } =
      await setupWithHouseholdMember();
    const mara = await person("Mara Lin", null);
    const sharedSource = await sourceRecord({
      content: "Mara shared context for review.",
      status: "pending_resolution",
      scope: "shared",
      householdId: household.id,
    });
    await store.createHouseholdRecordShare({
      householdId: household.id,
      recordKind: "source_record",
      recordId: sharedSource.id,
      sharedWithUserId: memberUserId,
      sharedByUserId: OWNER,
    });
    const privateSource = await sourceRecord({
      content: "Private review source should not leak.",
      status: "pending_resolution",
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

  /**
   * A note that names someone Tendnote could not match still needs the owner, even
   * though it is already attached to a person. Once the same note is resolved to
   * `active` it is filed and must stop asking: that is the difference between work
   * waiting and work done, and it is the whole reason the gate is on status.
   */
  it("asks about a person-linked source record only while it awaits resolution", async () => {
    const { store, agenda, person, sourceRecord } = await setup();
    const mara = await person("Mara Lin", null);
    const pending = await sourceRecord({
      content: "Mara and Kris are coming to dinner.",
      status: "pending_resolution",
    });
    const linkedPeople = [{ id: mara.id, displayName: mara.displayName }];
    store.seedSourceRecordReviews([{ sourceRecord: pending, linkedPeople }]);

    await expect(
      agenda.getRelationshipAgenda({
        ownerUserId: OWNER,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        includeKinds: ["review_item"],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        kind: "review_item",
        personId: mara.id,
        personDisplayName: "Mara Lin",
        title: "Who else is in this note?",
        reason: "Mara and Kris are coming to dinner.",
        sourceRefs: [{ kind: "source_record", id: pending.id }],
      }),
    ]);

    store.seedSourceRecordReviews([
      { sourceRecord: { ...pending, status: "active" }, linkedPeople },
    ]);

    await expect(
      agenda.getRelationshipAgenda({
        ownerUserId: OWNER,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        includeKinds: ["review_item"],
      }),
    ).resolves.toEqual([]);
  });

  it("keeps personless source-record reviews lower priority and asks for resolution", async () => {
    const { store, followups, agenda, person, sourceRecord } = await setup();
    const mara = await person("Mara Lin", null);
    const personless = await sourceRecord({
      content: "Someone from the conference mentioned a promotion.",
      status: "pending_resolution",
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
        title: "Who is this note about?",
        reason: "Someone from the conference mentioned a promotion.",
        sourceRefs: [{ kind: "source_record", id: personless.id }],
        rank: 2,
      }),
    ]);
    expect(result.map((candidate) => candidate.sourceRefs[0]?.id)).not.toContain("archived-source");
  });

  it("kind filters exclude review items from deterministic agenda reads", async () => {
    const { store, agenda, person, sourceRecord } = await setup();
    const mara = await person("Mara Lin", null);
    const moveNote = await sourceRecord({ content: "Mara mentioned a possible move." });
    store.seedSuggestedMemories([
      suggestedMemory({
        personId: mara.id,
        sourceRecordId: moveNote.id,
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
    const { agenda, moveNote, followup } = await bothReviewKindsFromOneNote();

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
          { kind: "source_record", id: moveNote.id },
        ],
      }),
    ]);
  });

  it("keeps review_item filters separate from suggested follow-up filters", async () => {
    const { agenda } = await bothReviewKindsFromOneNote();

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
    ]);
    expect(reviewOnly.map((candidate) => candidate.kind)).not.toContain("suggested_followup");
  });

  it("owner-scopes review candidates even when an adapter returns extra rows", async () => {
    const { store, agenda, person, sourceRecord } = await setup();
    const mara = await person("Mara Lin", null);
    const intruder = await person("Hidden Person", null, OTHER_OWNER);
    const moveNote = await sourceRecord({ content: "Mara mentioned a possible move." });
    const otherSourceRecord = await sourceRecord({
      content: "Should not leak.",
      ownerUserId: OTHER_OWNER,
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
        sourceRecordId: moveNote.id,
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
