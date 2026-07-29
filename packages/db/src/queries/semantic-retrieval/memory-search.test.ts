import { describe, expect, it } from "vitest";
import type { HouseholdRecordShare } from "../households/types";
import type { MemoryUpdatePatch } from "../memories/types";
import {
  createHarness,
  EMBEDDING_CONFIG,
  OTHER_OWNER,
  OWNER,
  topicVectorAdapter,
  topicVectorFor,
} from "./harness";
import { createSemanticRetrievalQueries } from "./queries";

const householdId = "99999999-9999-4999-8999-999999999999";

/**
 * Embed a memory, edit its sensitivity, and run the job again - the write path the
 * sensitivity cases below ask a *retrieval* question about. The reprocessed job result comes
 * back with the queries: whether the second pass converged the row or refused it is the
 * whole difference between a memory that stays retrievable and one that is withheld.
 */
async function embedThenEditSensitivity(patch: MemoryUpdatePatch) {
  const { store, createApprovedMemory, embedMemory } = createHarness({
    adapter: topicVectorAdapter,
  });
  const memory = await createApprovedMemory({
    content: "Mara loves cooking classes and handmade kitchen gifts.",
  });
  await embedMemory(memory.id);
  const edited = await store.updateMemory({ ownerUserId: OWNER, memoryId: memory.id, patch });
  const reprocessed = await embedMemory(edited.id);

  return {
    memory,
    reprocessed,
    queries: createSemanticRetrievalQueries(store, topicVectorAdapter, EMBEDDING_CONFIG),
  };
}

describe("semantic retrieval - approved memory results", () => {
  it("applies household visibility before returning memory semantic results", async () => {
    const householdRecordShares: HouseholdRecordShare[] = [];
    const { store, createApprovedMemory, embedMemory } = createHarness({
      adapter: topicVectorAdapter,
      householdMemberships: [
        {
          id: "membership-owner",
          householdId,
          userId: OWNER,
          invitedByUserId: OTHER_OWNER,
          role: "member",
          status: "active",
          invitedAt: new Date("2026-06-26T00:00:00Z"),
          acceptedAt: new Date("2026-06-26T00:00:00Z"),
          removedAt: null,
          createdAt: new Date("2026-06-26T00:00:00Z"),
          updatedAt: new Date("2026-06-26T00:00:00Z"),
        },
        {
          id: "membership-member",
          householdId,
          userId: OTHER_OWNER,
          invitedByUserId: OTHER_OWNER,
          role: "owner",
          status: "active",
          invitedAt: new Date("2026-06-26T00:00:00Z"),
          acceptedAt: new Date("2026-06-26T00:00:00Z"),
          removedAt: null,
          createdAt: new Date("2026-06-26T00:00:00Z"),
          updatedAt: new Date("2026-06-26T00:00:00Z"),
        },
      ],
      householdRecordShares,
    });
    const privateMemory = await createApprovedMemory({
      ownerUserId: OTHER_OWNER,
      content: "Mara keeps private cooking notes.",
    });
    const sharedMemory = await createApprovedMemory({
      ownerUserId: OTHER_OWNER,
      content: "Mara shared cooking gift notes.",
      scope: "shared",
      householdId,
    });
    householdRecordShares.push({
      id: "share-memory",
      householdId,
      recordKind: "memory",
      recordId: sharedMemory.id,
      sharedWithUserId: OWNER,
      sharedByUserId: OTHER_OWNER,
      createdAt: new Date("2026-06-26T00:00:00Z"),
    });

    for (const memory of [privateMemory, sharedMemory]) {
      await embedMemory(memory.id, memory.ownerUserId);
    }
    const queries = createSemanticRetrievalQueries(store, topicVectorAdapter, EMBEDDING_CONFIG);

    const results = await queries.searchSemanticContext({
      ownerUserId: OWNER,
      query: "gift ideas",
      recordKinds: ["memory"],
      limit: 5,
      minimumSimilarity: 0.5,
      directlyRequested: false,
    });

    expect(results.map((result) => result.recordId)).toEqual([sharedMemory.id]);
    expect(results[0]).toEqual(
      expect.objectContaining({
        visibilityChoice: "selected_members",
        visibilityLabel: "Specific people",
        relatedPersonId: null,
        relatedPersonDisplayName: null,
      }),
    );
  });

  it("searches approved-memory embeddings with compact person-aware results", async () => {
    const { store, createApprovedMemory, embedMemory } = createHarness({
      adapter: topicVectorAdapter,
    });
    const memory = await createApprovedMemory({
      content: "Mara loves cooking classes and handmade kitchen gifts.",
    });
    await embedMemory(memory.id);
    const queries = createSemanticRetrievalQueries(store, topicVectorAdapter, EMBEDDING_CONFIG);

    const results = await queries.searchSemanticContext({
      ownerUserId: OWNER,
      query: "gift ideas",
      recordKinds: ["memory"],
      limit: 5,
      minimumSimilarity: 0.5,
      directlyRequested: false,
    });

    expect(results).toEqual([
      expect.objectContaining({
        recordKind: "memory",
        recordId: memory.id,
        relatedPersonId: memory.personId,
        relatedPersonDisplayName: "Mara Lin",
        snippet: "Mara loves cooking classes and handmade kitchen gifts.",
        similarity: 1,
        trustLevel: "confirmed_fact",
        sensitivity: "normal",
        sourceRefs: [{ kind: "memory", id: memory.id }],
        routing: {
          personId: memory.personId,
          recordKind: "memory",
          recordId: memory.id,
        },
      }),
    ]);
  });

  it("applies owner, person, kind, limit, and minimum-similarity filters", async () => {
    const { store, createApprovedMemory, embedMemory } = createHarness({
      adapter: topicVectorAdapter,
    });
    const cooking = await createApprovedMemory({
      content: "Mara loves cooking classes and handmade kitchen gifts.",
      importance: 1,
    });
    const career = await createApprovedMemory({
      content: "Mara is considering a career move into backend leadership.",
      importance: 5,
    });
    const otherOwner = await createApprovedMemory({
      ownerUserId: OTHER_OWNER,
      content: "Other owner has cooking context.",
    });

    for (const memory of [cooking, career, otherOwner]) {
      await embedMemory(memory.id, memory.ownerUserId);
    }

    const queries = createSemanticRetrievalQueries(store, topicVectorAdapter, EMBEDDING_CONFIG);
    const personResults = await queries.searchSemanticContext({
      ownerUserId: OWNER,
      query: "gift ideas",
      personId: cooking.personId,
      limit: 1,
      minimumSimilarity: 0.5,
      directlyRequested: false,
    });
    const sourceOnlyResults = await queries.searchSemanticContext({
      ownerUserId: OWNER,
      query: "gift ideas",
      recordKinds: ["source_record"],
      limit: 5,
      minimumSimilarity: 0,
      directlyRequested: false,
    });

    expect(personResults.map((result) => result.recordId)).toEqual([cooking.id]);
    expect(sourceOnlyResults).toEqual([]);
  });

  it("keeps similarity ahead of importance and recency tie-breakers", async () => {
    const { store, createApprovedMemory, embedMemory } = createHarness({
      adapter: topicVectorAdapter,
    });
    const strong = await createApprovedMemory({
      content: "Mara loves cooking classes and handmade kitchen gifts.",
      importance: 1,
      updatedAt: new Date("2026-06-01T00:00:00Z"),
    });
    const weak = await createApprovedMemory({
      content: "Mara is considering a career move into backend leadership.",
      importance: 5,
      updatedAt: new Date("2026-06-20T00:00:00Z"),
    });

    for (const memory of [weak, strong]) {
      await embedMemory(memory.id);
    }

    const queries = createSemanticRetrievalQueries(store, topicVectorAdapter, EMBEDDING_CONFIG);
    const results = await queries.searchSemanticContext({
      ownerUserId: OWNER,
      query: "gift ideas",
      limit: 2,
      minimumSimilarity: 0,
      directlyRequested: false,
    });

    expect(results.map((result) => result.recordId)).toEqual([strong.id, weak.id]);
  });

  it("fails open for missing, stale, incompatible, and ineligible embeddings", async () => {
    const { store, createApprovedMemory, embedMemory } = createHarness({
      adapter: topicVectorAdapter,
    });
    const stale = await createApprovedMemory({
      content: "Mara loves cooking classes and handmade kitchen gifts.",
    });
    const suggested = await createApprovedMemory({
      content: "Mara likes stressful puzzle games.",
      status: "suggested",
      approvedAt: null,
    });
    await embedMemory(stale.id);
    await store.updateMemory({
      ownerUserId: OWNER,
      memoryId: stale.id,
      patch: { content: "Mara prefers ceramic studio classes." },
    });
    await store.upsertRelationshipContextEmbedding({
      ownerUserId: OWNER,
      personId: suggested.personId,
      recordKind: "memory",
      recordId: suggested.id,
      embedding: [1, 0, 0, 0],
      embeddingModel: EMBEDDING_CONFIG.model,
      embeddingVersion: "old-version",
      embeddingDimensions: 4,
      embeddedText: suggested.content,
      contentFingerprint: "manual",
      trustLevel: "confirmed_fact",
      sensitivity: "normal",
      sourceUpdatedAt: suggested.updatedAt,
    });
    const queries = createSemanticRetrievalQueries(store, topicVectorAdapter, EMBEDDING_CONFIG);

    const results = await queries.searchSemanticContext({
      ownerUserId: OWNER,
      query: "gift ideas",
      limit: 5,
      minimumSimilarity: 0,
      directlyRequested: false,
    });

    expect(results).toEqual([]);
  });

  /**
   * Staleness is content-addressed, not timestamp-addressed (ADR 0013). Nudging a memory's
   * importance bumps its `updatedAt` past the embedding's `sourceUpdatedAt` without changing
   * a word of what was embedded, so the vector still describes the memory exactly.
   *
   * This is a regression guard, not a hypothetical. A `sourceUpdatedAt === updatedAt` gate
   * used to sit in both stores and it emptied the Related bucket of Global Recall: in
   * Postgres the two columns are unequal by construction (microsecond `defaultNow()` versus
   * a millisecond-truncated JS `Date`), and because `reuseOrEmbed` short-circuits on a
   * matching content fingerprint, re-enqueueing the job never refreshed `sourceUpdatedAt`.
   * Once a memory fell out it could never come back.
   */
  it("keeps retrieving a memory whose sourceUpdatedAt trails its updatedAt", async () => {
    const { store, createApprovedMemory } = createHarness({ adapter: topicVectorAdapter });
    const memory = await createApprovedMemory({
      content: "Mara prefers handmade cooking gifts.",
    });
    await store.upsertRelationshipContextEmbedding({
      ownerUserId: OWNER,
      personId: memory.personId,
      recordKind: "memory",
      recordId: memory.id,
      embedding: topicVectorFor(memory.content),
      embeddingModel: EMBEDDING_CONFIG.model,
      embeddingVersion: EMBEDDING_CONFIG.version,
      embeddingDimensions: 4,
      // Unchanged: the vector still describes this memory word for word.
      embeddedText: memory.content,
      contentFingerprint: "manual-lagging-source-updated-at",
      trustLevel: "confirmed_fact",
      sensitivity: "normal",
      // What Postgres actually stores. `memories.updated_at` is written by `defaultNow()`
      // with microsecond precision; the driver truncates those microseconds when it hands
      // the value to JS, so the timestamp written back here trails the record's own by a
      // fraction of a millisecond - always, and for every row.
      sourceUpdatedAt: new Date(memory.updatedAt.getTime() - 1),
    });
    const queries = createSemanticRetrievalQueries(store, topicVectorAdapter, EMBEDDING_CONFIG);

    const results = await queries.searchSemanticContext({
      ownerUserId: OWNER,
      query: "gift ideas",
      limit: 5,
      minimumSimilarity: 0,
      directlyRequested: false,
    });

    expect(results.map((result) => result.recordId)).toEqual([memory.id]);
  });

  /**
   * The retrieval-side half of the write-side convergence pinned in the approved-memory job
   * suite. Raising a memory from `normal` to `sensitive` changes no word of what was
   * embedded, so the vector still describes it exactly and it must stay retrievable:
   * `sensitive` is a labelling register, not a withholding one.
   *
   * Before the reuse seam converged its metadata this was an unrecoverable eviction: the
   * fingerprint still matched, so the row kept saying `normal` forever while `e.sensitivity
   * = m.sensitivity` dropped it from every search.
   */
  it("keeps retrieving a memory whose sensitivity was edited after it was embedded", async () => {
    const { memory, queries } = await embedThenEditSensitivity({ sensitivity: "sensitive" });

    const results = await queries.searchSemanticContext({
      ownerUserId: OWNER,
      query: "gift ideas",
      recordKinds: ["memory"],
      limit: 5,
      minimumSimilarity: 0.5,
      directlyRequested: false,
    });

    expect(results.map((result) => result.recordId)).toEqual([memory.id]);
    expect(results[0]?.sensitivity).toBe("sensitive");
  });

  /**
   * Convergence must not become a back door into restricted content. A memory edited to
   * `restricted` is skipped by the embed decision (restricted text is never sent to an
   * embedding provider), so the reuse seam never runs and the row keeps the `normal`
   * sensitivity, and the full text, it was embedded with. The `e.sensitivity = m.sensitivity`
   * equality is what withholds it, and it withholds it even from a direct request: the
   * vector predates the restriction and nothing has re-authorised it.
   */
  it("withholds a memory restricted after embedding, direct request included", async () => {
    const { reprocessed, queries } = await embedThenEditSensitivity({ sensitivity: "restricted" });

    const hidden = await queries.searchSemanticContext({
      ownerUserId: OWNER,
      query: "gift ideas",
      limit: 5,
      minimumSimilarity: 0,
      directlyRequested: false,
    });
    const direct = await queries.searchSemanticContext({
      ownerUserId: OWNER,
      query: "gift ideas",
      limit: 5,
      minimumSimilarity: 0,
      directlyRequested: true,
    });

    expect(reprocessed).toEqual(
      expect.objectContaining({ outcome: "skipped", reason: "restricted_content" }),
    );
    expect(hidden).toEqual([]);
    expect(direct).toEqual([]);
  });

  it("excludes restricted memory embeddings by default and returns them only when directly requested", async () => {
    const { store, createApprovedMemory } = createHarness({ adapter: topicVectorAdapter });
    const restricted = await createApprovedMemory({
      content: "Mara shared a stressful family situation.",
      sensitivity: "restricted",
    });
    await store.upsertRelationshipContextEmbedding({
      ownerUserId: OWNER,
      personId: restricted.personId,
      recordKind: "memory",
      recordId: restricted.id,
      embedding: topicVectorFor(restricted.content),
      embeddingModel: EMBEDDING_CONFIG.model,
      embeddingVersion: EMBEDDING_CONFIG.version,
      embeddingDimensions: 4,
      embeddedText: restricted.content,
      contentFingerprint: "manual",
      trustLevel: "confirmed_fact",
      sensitivity: "restricted",
      sourceUpdatedAt: restricted.updatedAt,
    });
    const queries = createSemanticRetrievalQueries(store, topicVectorAdapter, EMBEDDING_CONFIG);

    const hidden = await queries.searchSemanticContext({
      ownerUserId: OWNER,
      query: "stressful events",
      limit: 5,
      minimumSimilarity: 0,
      directlyRequested: false,
    });
    const direct = await queries.searchSemanticContext({
      ownerUserId: OWNER,
      query: "stressful events",
      limit: 5,
      minimumSimilarity: 0,
      directlyRequested: true,
    });

    expect(hidden).toEqual([]);
    expect(direct.map((result) => result.recordId)).toEqual([restricted.id]);
    expect(direct[0]?.sensitivity).toBe("restricted");
  });
});
