import { describe, expect, it } from "vitest";
import { createMemoryCapture } from "./memories/capture";
import { createInMemoryMemoryStore } from "./memories/in-memory-store";
import { createMemoryReview } from "./memories/review";
import { createSourceRecordCapture } from "./source-records/capture";
import { createInMemorySourceRecordStore } from "./source-records/in-memory-store";
import { createSourceRecordResolution } from "./source-records/resolution";

const OWNER = "user-1";

async function makePerson(store: ReturnType<typeof createInMemoryMemoryStore>) {
  return store.createPerson({
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
}

/**
 * ADR 0055: Phase 1A reserves shared/household scope in the schema but blocks
 * non-private writes through the product mutation flows. These tests assert the
 * product surfaces only ever persist `private` scope — there is no product path
 * to write a shared or household record yet.
 */
describe("Phase 1A scope policy: product flows write private scope only", () => {
  it("captures source records as private", async () => {
    const capture = createSourceRecordCapture(createInMemorySourceRecordStore());

    const { sourceRecord } = await capture.captureSourceRecord({
      ownerUserId: OWNER,
      retainedContent: "Logged lunch with Mark.",
    });

    expect(sourceRecord.scope).toBe("private");
  });

  it("blocks a non-private scope pushed through the source-record capture flow", async () => {
    const capture = createSourceRecordCapture(createInMemorySourceRecordStore());

    // A caller that smuggles `scope: "shared"` into the product input must not be
    // able to write a non-private record — the flow ignores it and writes private.
    const smuggled = {
      ownerUserId: OWNER,
      retainedContent: "Trying to share this.",
      scope: "shared",
    } as Parameters<typeof capture.captureSourceRecord>[0];

    const { sourceRecord } = await capture.captureSourceRecord(smuggled);

    expect(sourceRecord.scope).toBe("private");
  });

  it("blocks a non-private scope pushed through the explicit-memory flow", async () => {
    const store = createInMemoryMemoryStore();
    const capture = createMemoryCapture(store);
    const person = await makePerson(store);

    const smuggled = {
      ownerUserId: OWNER,
      personId: person.id,
      content: "Trying to share a memory.",
      scope: "household",
    } as Parameters<typeof capture.captureExplicitMemory>[0];

    const { memory, sourceRecord } = await capture.captureExplicitMemory(smuggled);

    expect(memory.scope).toBe("private");
    expect(sourceRecord.scope).toBe("private");
  });

  it("captures context-linked source records as private", async () => {
    const store = createInMemoryMemoryStore();
    const resolution = createSourceRecordResolution(store);
    const person = await makePerson(store);

    const { sourceRecord } = await resolution.captureSourceRecordForPerson({
      ownerUserId: OWNER,
      personId: person.id,
      retainedContent: "Coffee with Mark.",
    });

    expect(sourceRecord.scope).toBe("private");
  });

  it("captures explicit memories and their source records as private", async () => {
    const store = createInMemoryMemoryStore();
    const capture = createMemoryCapture(store);
    const person = await makePerson(store);

    const { memory, sourceRecord } = await capture.captureExplicitMemory({
      ownerUserId: OWNER,
      personId: person.id,
      content: "Mark is vegetarian.",
    });

    expect(memory.scope).toBe("private");
    expect(sourceRecord.scope).toBe("private");
  });

  it("keeps approved memories private after review save, even with an edit", async () => {
    const store = createInMemoryMemoryStore();
    const capture = createMemoryCapture(store);
    const review = createMemoryReview(store);
    const person = await makePerson(store);

    // Seed a suggested memory by hand-rolling provenance, then approve it.
    const { sourceRecord } = await capture.captureExplicitMemory({
      ownerUserId: OWNER,
      personId: person.id,
      content: "placeholder",
    });
    const suggested = await store.createMemory({
      personId: person.id,
      ownerUserId: OWNER,
      sourceRecordId: sourceRecord.id,
      memoryType: "context",
      content: "Mark might be switching jobs.",
      status: "suggested",
      importance: 3,
      sensitivity: "normal",
      confidence: "medium",
      scope: "private",
    });

    const result = await review.saveSuggestedMemory({
      ownerUserId: OWNER,
      memoryId: suggested.id,
      edit: { content: "Mark switched jobs.", sensitivity: "sensitive" },
    });

    expect(result.memory.scope).toBe("private");
    expect(result.memory.status).toBe("approved");
  });
});

/**
 * Fixed typed assistant components must reference persisted records by id and
 * carry no unpersisted action state (ADR 0027, ADR 0028) — the UI reloads the
 * authoritative record before any mutation.
 */
describe("assistant components reference persisted records only", () => {
  it("source_record_review carries only its type and a persisted id", async () => {
    const capture = createSourceRecordCapture(createInMemorySourceRecordStore());
    const { component } = await capture.captureSourceRecord({
      ownerUserId: OWNER,
      retainedContent: "Logged context.",
    });

    expect(Object.keys(component).sort()).toEqual(["sourceRecordId", "type"]);
    expect(component.type).toBe("source_record_review");
  });

  it("suggested_memory_review carries only its type and persisted ids", async () => {
    const store = createInMemoryMemoryStore();
    const review = createMemoryReview(store);
    const capture = createMemoryCapture(store);
    const person = await makePerson(store);
    const { sourceRecord } = await capture.captureExplicitMemory({
      ownerUserId: OWNER,
      personId: person.id,
      content: "placeholder",
    });
    const suggested = await store.createMemory({
      personId: person.id,
      ownerUserId: OWNER,
      sourceRecordId: sourceRecord.id,
      memoryType: "context",
      content: "Tentative observation.",
      status: "suggested",
      importance: 3,
      sensitivity: "normal",
      confidence: "medium",
      scope: "private",
    });

    const result = await review.getSuggestedMemoryReview({
      ownerUserId: OWNER,
      memoryId: suggested.id,
    });

    expect(result).not.toBeNull();
    expect(Object.keys(result?.component ?? {}).sort()).toEqual([
      "memoryId",
      "sourceRecordId",
      "type",
    ]);
    expect(result?.component.type).toBe("suggested_memory_review");
  });
});
