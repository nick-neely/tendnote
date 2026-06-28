import {
  createMemorySchema,
  createSourceRecordSchema,
  sourceRecordAutoApprovesMemories,
} from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createInMemoryMemoryStore, createMemoryReview } from "../memories";

type Store = ReturnType<typeof createInMemoryMemoryStore>;

async function seedPerson(store: Store) {
  return store.createPerson({
    ownerUserId: "user-1",
    displayName: "Caleb",
    firstName: null,
    lastName: null,
    birthday: null,
    relationshipType: "friend",
    closenessLevel: 3,
    profileBlurb: null,
    source: "manual",
  });
}

async function seedLoggedNote(store: Store) {
  return store.createSourceRecord(
    createSourceRecordSchema.parse({
      ownerUserId: "user-1",
      sourceType: "manual",
      content: "Had lunch with Caleb — he might switch teams.",
      status: "active",
    }),
  );
}

async function seedSuggestedMemory(store: Store, personId: string, sourceRecordId: string) {
  return store.createMemory(
    createMemorySchema.parse({
      personId,
      ownerUserId: "user-1",
      sourceRecordId,
      memoryType: "context",
      content: "Caleb might switch teams at work.",
      status: "suggested",
      importance: 3,
      sensitivity: "normal",
      confidence: "medium",
      scope: "private",
    }),
  );
}

describe("approveExtractedMemoriesForSourceRecord (approve a logged note inline)", () => {
  it("pre-approves the note and approves suggestions already extracted, scheduling embeddings", async () => {
    const store = createInMemoryMemoryStore();
    const scheduled: Array<{ recordId: string }> = [];
    const review = createMemoryReview(store, {
      async scheduleApprovedMemoryEmbedding(input) {
        scheduled.push(input);
      },
    });
    const caleb = await seedPerson(store);
    const note = await seedLoggedNote(store);
    const suggestion = await seedSuggestedMemory(store, caleb.id, note.id);

    const result = await review.approveExtractedMemoriesForSourceRecord({
      ownerUserId: "user-1",
      sourceRecordId: note.id,
    });

    expect(result).toEqual({
      sourceRecordId: note.id,
      autoApprove: true,
      approvedMemoryIds: [suggestion.id],
    });

    // The already-extracted suggestion is now a confirmed fact, embedding scheduled.
    const updated = await store.getMemory({ ownerUserId: "user-1", memoryId: suggestion.id });
    expect(updated?.status).toBe("approved");
    expect(updated?.approvedAt).toBeInstanceOf(Date);
    expect(scheduled).toEqual([
      expect.objectContaining({ recordId: suggestion.id, recordKind: "memory" }),
    ]);

    // The note is flagged so a later extraction pass auto-approves too.
    const reloaded = await store.getSourceRecord({
      ownerUserId: "user-1",
      sourceRecordId: note.id,
    });
    expect(sourceRecordAutoApprovesMemories(reloaded?.metadataJson)).toBe(true);
  });

  it("still sets the flag when nothing has been extracted yet (background case)", async () => {
    const store = createInMemoryMemoryStore();
    const review = createMemoryReview(store);
    const note = await seedLoggedNote(store);

    const result = await review.approveExtractedMemoriesForSourceRecord({
      ownerUserId: "user-1",
      sourceRecordId: note.id,
    });

    expect(result.approvedMemoryIds).toEqual([]);
    expect(result.autoApprove).toBe(true);
    const reloaded = await store.getSourceRecord({
      ownerUserId: "user-1",
      sourceRecordId: note.id,
    });
    expect(sourceRecordAutoApprovesMemories(reloaded?.metadataJson)).toBe(true);
  });

  it("rejects another owner's source record", async () => {
    const store = createInMemoryMemoryStore();
    const review = createMemoryReview(store);
    const note = await seedLoggedNote(store);

    await expect(
      review.approveExtractedMemoriesForSourceRecord({
        ownerUserId: "user-2",
        sourceRecordId: note.id,
      }),
    ).rejects.toThrow("Source record not found.");
  });
});

describe("dismissExtractedMemoriesForSourceRecord (dismiss a logged note inline)", () => {
  it("dismisses the note and its already-extracted suggestions", async () => {
    const store = createInMemoryMemoryStore();
    const review = createMemoryReview(store);
    const caleb = await seedPerson(store);
    const note = await seedLoggedNote(store);
    const suggestion = await seedSuggestedMemory(store, caleb.id, note.id);

    const result = await review.dismissExtractedMemoriesForSourceRecord({
      ownerUserId: "user-1",
      sourceRecordId: note.id,
    });

    expect(result.status).toBe("dismissed");
    expect(result.dismissedMemoryIds).toEqual([suggestion.id]);

    const updatedMemory = await store.getMemory({ ownerUserId: "user-1", memoryId: suggestion.id });
    expect(updatedMemory?.status).toBe("dismissed");
    // A dismissed (non-active) note is skipped by future extraction.
    const reloaded = await store.getSourceRecord({
      ownerUserId: "user-1",
      sourceRecordId: note.id,
    });
    expect(reloaded?.status).toBe("dismissed");
  });
});
