import { describe, expect, it } from "vitest";
import { createInMemoryMemoryStore } from "./in-memory-store";
import { createMemoryReview } from "./review";

const OWNER = "user-1";

async function setup() {
  const store = createInMemoryMemoryStore();
  const review = createMemoryReview(store);

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

  async function seedSuggestion(input?: {
    content?: string;
    sensitivity?: "normal" | "sensitive" | "restricted";
  }) {
    const sourceRecord = await store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: input?.content ?? "Mark may be switching jobs.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: input?.sensitivity ?? "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
    const memory = await store.createMemory({
      personId: person.id,
      ownerUserId: OWNER,
      sourceRecordId: sourceRecord.id,
      memoryType: "context",
      content: input?.content ?? "Mark may be switching jobs.",
      status: "suggested",
      importance: 3,
      sensitivity: input?.sensitivity ?? "normal",
      confidence: "medium",
      scope: "private",
    });

    return { sourceRecord, memory };
  }

  const auditActions = async () =>
    (await store.listAuditLogEntries({ ownerUserId: OWNER })).map((entry) => entry.action);

  return { store, review, person, seedSuggestion, auditActions };
}

describe("suggested memory review surface", () => {
  it("lists suggested memories backed by persisted memory and source-record ids", async () => {
    const { review, seedSuggestion } = await setup();
    const { memory, sourceRecord } = await seedSuggestion();

    const reviews = await review.listSuggestedMemoryReviews({ ownerUserId: OWNER });

    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.component).toEqual({
      type: "suggested_memory_review",
      memoryId: memory.id,
      sourceRecordId: sourceRecord.id,
    });
    // Source context is included so the user sees where the suggestion came from.
    expect(reviews[0]?.sourceRecord?.id).toBe(sourceRecord.id);
    expect(reviews[0]?.sourceRecord?.content).toBe("Mark may be switching jobs.");
  });

  it("excludes another owner's suggestions", async () => {
    const { store, review, seedSuggestion } = await setup();
    await seedSuggestion();

    await expect(review.listSuggestedMemoryReviews({ ownerUserId: "intruder" })).resolves.toEqual(
      [],
    );
    // And a cross-owner save is rejected.
    const suggestions = await store.listSuggestedMemoriesForOwner({ ownerUserId: OWNER });
    await expect(
      review.saveSuggestedMemory({ ownerUserId: "intruder", memoryId: suggestions[0]?.id ?? "" }),
    ).rejects.toThrow();
  });
});

describe("save suggested memory", () => {
  it("promotes a suggestion to approved durable context with an audit entry", async () => {
    const { store, review, person, seedSuggestion, auditActions } = await setup();
    const { memory } = await seedSuggestion();

    const result = await review.saveSuggestedMemory({ ownerUserId: OWNER, memoryId: memory.id });

    expect(result.memory.status).toBe("approved");
    expect(result.memory.approvedAt).not.toBeNull();
    await expect(
      store.listApprovedMemoriesForPerson({ ownerUserId: OWNER, personId: person.id }),
    ).resolves.toHaveLength(1);
    await expect(auditActions()).resolves.toContain("memory.review_save");
  });

  it("applies an edit on save, with a manual sensitivity override winning", async () => {
    const { review, seedSuggestion } = await setup();
    const { memory } = await seedSuggestion();

    const result = await review.saveSuggestedMemory({
      ownerUserId: OWNER,
      memoryId: memory.id,
      edit: { content: "Mark switched jobs in May.", sensitivity: "restricted" },
    });

    expect(result.memory.content).toBe("Mark switched jobs in May.");
    expect(result.memory.sensitivity).toBe("restricted");
    expect(result.memory.status).toBe("approved");
  });

  it("rejects saving a memory that is no longer suggested", async () => {
    const { review, seedSuggestion } = await setup();
    const { memory } = await seedSuggestion();
    await review.saveSuggestedMemory({ ownerUserId: OWNER, memoryId: memory.id });

    await expect(
      review.saveSuggestedMemory({ ownerUserId: OWNER, memoryId: memory.id }),
    ).rejects.toThrow();
  });
});

describe("edit suggested memory", () => {
  it("updates the suggestion in place without approving it", async () => {
    const { review, seedSuggestion, auditActions } = await setup();
    const { memory } = await seedSuggestion();

    const result = await review.editSuggestedMemory({
      ownerUserId: OWNER,
      memoryId: memory.id,
      edit: { content: "Mark is exploring backend roles." },
    });

    expect(result.memory.status).toBe("suggested");
    expect(result.memory.content).toBe("Mark is exploring backend roles.");
    await expect(auditActions()).resolves.toContain("memory.review_edit");
  });
});

describe("dismiss and archive", () => {
  it("dismisses a suggestion so it leaves review and retrieval and is not reintroduced", async () => {
    const { store, review, person, seedSuggestion, auditActions } = await setup();
    const { memory } = await seedSuggestion();

    const dismissed = await review.dismissSuggestedMemory({
      ownerUserId: OWNER,
      memoryId: memory.id,
    });

    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.dismissedAt).not.toBeNull();
    await expect(review.listSuggestedMemoryReviews({ ownerUserId: OWNER })).resolves.toEqual([]);
    await expect(
      store.listApprovedMemoriesForPerson({ ownerUserId: OWNER, personId: person.id }),
    ).resolves.toEqual([]);
    await expect(auditActions()).resolves.toContain("memory.review_dismiss");
  });

  it("archives an approved memory out of normal views while keeping history", async () => {
    const { store, review, person, seedSuggestion, auditActions } = await setup();
    const { memory } = await seedSuggestion();
    await review.saveSuggestedMemory({ ownerUserId: OWNER, memoryId: memory.id });

    const archived = await review.archiveMemory({ ownerUserId: OWNER, memoryId: memory.id });

    expect(archived.status).toBe("archived");
    await expect(
      store.listApprovedMemoriesForPerson({ ownerUserId: OWNER, personId: person.id }),
    ).resolves.toEqual([]);
    await expect(auditActions()).resolves.toContain("memory.review_archive");
  });
});

describe("restricted suggestions stay reviewable but not proactive", () => {
  it("shows a restricted suggestion in the review surface", async () => {
    const { review, seedSuggestion } = await setup();
    await seedSuggestion({ sensitivity: "restricted" });

    const reviews = await review.listSuggestedMemoryReviews({ ownerUserId: OWNER });

    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.memory.sensitivity).toBe("restricted");
    expect(reviews[0]?.memory.status).toBe("suggested");
  });
});
