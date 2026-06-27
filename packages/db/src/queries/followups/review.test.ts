import { describe, expect, it } from "vitest";
import { createInMemoryFollowupLifecycleStore } from "./in-memory-store";
import { createSuggestedFollowupReview } from "./review";

const OWNER = "user-1";

async function setup() {
  const store = createInMemoryFollowupLifecycleStore();
  const review = createSuggestedFollowupReview(store);

  const person = await store.createPerson({
    ownerUserId: OWNER,
    displayName: "Mark",
    firstName: null,
    lastName: null,
    birthday: null,
    relationshipType: "friend",
    closenessLevel: 3,
    profileBlurb: null,
    source: "manual",
  });

  async function seedSourceRecord(content = "Had lunch with Mark; he starts a new job in July.") {
    return store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content,
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
  }

  async function seedSuggestion(overrides: { reason?: string; dueAt?: Date } = {}) {
    const sourceRecord = await seedSourceRecord();
    const result = await review.suggestFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: overrides.reason ?? "Check in about the new job.",
      dueAt: overrides.dueAt ?? new Date("2026-07-15T00:00:00Z"),
      sourceRecordId: sourceRecord.id,
    });

    return { sourceRecord, result };
  }

  const auditActions = async () =>
    (await store.listAuditLogEntries({ ownerUserId: OWNER })).map((entry) => entry.action);

  return { store, review, person, seedSourceRecord, seedSuggestion, auditActions };
}

describe("suggest follow-up", () => {
  it("creates a suggested record grounded in a source record, not an active reminder", async () => {
    const { store, person, seedSuggestion, auditActions } = await setup();
    const { sourceRecord, result } = await seedSuggestion();

    expect(result.followup.status).toBe("suggested");
    expect(result.followup.sourceRecordId).toBe(sourceRecord.id);
    expect(result.component).toEqual({
      type: "suggested_followup_review",
      followupId: result.followup.id,
      sourceRecordId: sourceRecord.id,
    });
    expect(result.person?.displayName).toBe("Mark");
    expect(result.sourceRecord?.id).toBe(sourceRecord.id);
    // It is not an active reminder.
    await expect(store.listActiveFollowupsForOwner({ ownerUserId: OWNER })).resolves.toEqual([]);
    // ...but it does appear for the person's active-or-all listing as suggested only.
    await expect(
      store.listSuggestedFollowupsForOwner({ ownerUserId: OWNER, personId: person.id }),
    ).resolves.toHaveLength(1);
    await expect(auditActions()).resolves.toContain("followup.suggest");
  });

  it("requires a concrete due date", async () => {
    const { review, person, seedSourceRecord } = await setup();
    const sourceRecord = await seedSourceRecord();

    await expect(
      review.suggestFollowup({
        ownerUserId: OWNER,
        personId: person.id,
        reason: "Vague.",
        dueAt: new Date("not a date"),
        sourceRecordId: sourceRecord.id,
      }),
    ).rejects.toThrow(/concrete due date/);
  });

  it("requires grounding in an existing owner-scoped source record", async () => {
    const { review, person } = await setup();

    await expect(
      review.suggestFollowup({
        ownerUserId: OWNER,
        personId: person.id,
        reason: "Ungrounded.",
        dueAt: new Date("2026-07-15T00:00:00Z"),
        sourceRecordId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow(/grounded in a source record/);
  });
});

describe("suggested follow-up review surface", () => {
  it("lists suggestions backed by persisted follow-up and source-record ids", async () => {
    const { review, seedSuggestion } = await setup();
    const { sourceRecord, result } = await seedSuggestion();

    const reviews = await review.listSuggestedFollowupReviews({ ownerUserId: OWNER });

    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.component.followupId).toBe(result.followup.id);
    expect(reviews[0]?.sourceRecord?.id).toBe(sourceRecord.id);
    expect(reviews[0]?.person?.displayName).toBe("Mark");
  });

  it("excludes another owner's suggestions and rejects cross-owner accept", async () => {
    const { review, seedSuggestion } = await setup();
    const { result } = await seedSuggestion();

    await expect(review.listSuggestedFollowupReviews({ ownerUserId: "intruder" })).resolves.toEqual(
      [],
    );
    await expect(
      review.acceptSuggestedFollowup({ ownerUserId: "intruder", followupId: result.followup.id }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("accept, edit-before-accept, dismiss", () => {
  it("accepts a suggestion, promoting it to an active open reminder", async () => {
    const { store, review, seedSuggestion, auditActions } = await setup();
    const { result } = await seedSuggestion();

    const accepted = await review.acceptSuggestedFollowup({
      ownerUserId: OWNER,
      followupId: result.followup.id,
    });

    expect(accepted.followup.status).toBe("open");
    await expect(store.listActiveFollowupsForOwner({ ownerUserId: OWNER })).resolves.toHaveLength(
      1,
    );
    // No longer in the review queue.
    await expect(review.listSuggestedFollowupReviews({ ownerUserId: OWNER })).resolves.toEqual([]);
    await expect(auditActions()).resolves.toContain("followup.accept");
  });

  it("applies an edit to reason and due date before accepting", async () => {
    const { review, seedSuggestion } = await setup();
    const { result } = await seedSuggestion();

    const accepted = await review.acceptSuggestedFollowup({
      ownerUserId: OWNER,
      followupId: result.followup.id,
      edit: { reason: "Congratulate on the new role.", dueAt: new Date("2026-07-20T00:00:00Z") },
    });

    expect(accepted.followup.status).toBe("open");
    expect(accepted.followup.reason).toBe("Congratulate on the new role.");
    expect(accepted.followup.dueAt.toISOString()).toBe("2026-07-20T00:00:00.000Z");
  });

  it("edits a suggestion in place without accepting it", async () => {
    const { review, seedSuggestion, auditActions } = await setup();
    const { result } = await seedSuggestion();

    const edited = await review.editSuggestedFollowup({
      ownerUserId: OWNER,
      followupId: result.followup.id,
      edit: { reason: "Maybe grab coffee instead." },
    });

    expect(edited.followup.status).toBe("suggested");
    expect(edited.followup.reason).toBe("Maybe grab coffee instead.");
    await expect(auditActions()).resolves.toContain("followup.review_edit");
  });

  it("dismisses a suggestion so it leaves review and is not reintroduced", async () => {
    const { store, review, seedSuggestion, auditActions } = await setup();
    const { result } = await seedSuggestion();

    const dismissed = await review.dismissSuggestedFollowup({
      ownerUserId: OWNER,
      followupId: result.followup.id,
    });

    expect(dismissed.status).toBe("dismissed");
    await expect(review.listSuggestedFollowupReviews({ ownerUserId: OWNER })).resolves.toEqual([]);
    await expect(store.listActiveFollowupsForOwner({ ownerUserId: OWNER })).resolves.toEqual([]);
    await expect(auditActions()).resolves.toContain("followup.review_dismiss");
  });

  it("rejects accepting a follow-up that is no longer suggested", async () => {
    const { review, seedSuggestion } = await setup();
    const { result } = await seedSuggestion();
    await review.acceptSuggestedFollowup({ ownerUserId: OWNER, followupId: result.followup.id });

    await expect(
      review.acceptSuggestedFollowup({ ownerUserId: OWNER, followupId: result.followup.id }),
    ).rejects.toThrow(/Only suggested follow-ups/);
  });
});
