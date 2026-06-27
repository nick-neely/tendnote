import { describe, expect, it } from "vitest";
import { createHarness, EMBEDDING_CONFIG, OTHER_OWNER, OWNER } from "./harness";
import { createSemanticRetrievalQueries } from "./queries";
import type { EmbeddingAdapter } from "./types";

const vectorAdapter: EmbeddingAdapter = {
  async embedText(input) {
    return {
      vector: vectorFor(input.text),
      model: input.model,
      version: input.version,
    };
  },
};

function vectorFor(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("cooking") || lower.includes("gift")) return [1, 0, 0, 0];
  if (lower.includes("career") || lower.includes("job")) return [0, 1, 0, 0];
  if (lower.includes("stress")) return [0, 0, 1, 0];
  return [0, 0, 0, 1];
}

describe("semantic retrieval - approved memory results", () => {
  it("searches approved-memory embeddings with compact person-aware results", async () => {
    const { store, processor, createApprovedMemory } = createHarness({ adapter: vectorAdapter });
    const memory = await createApprovedMemory({
      content: "Mara loves cooking classes and handmade kitchen gifts.",
    });
    const { job } = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: memory.id,
    });
    await processor.processEmbeddingJob({ jobId: job.id });
    const queries = createSemanticRetrievalQueries(store, vectorAdapter, EMBEDDING_CONFIG);

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
    const { store, processor, createApprovedMemory } = createHarness({ adapter: vectorAdapter });
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
      const { job } = await processor.enqueueEmbeddingJob({
        ownerUserId: memory.ownerUserId,
        recordKind: "memory",
        recordId: memory.id,
      });
      await processor.processEmbeddingJob({ jobId: job.id });
    }

    const queries = createSemanticRetrievalQueries(store, vectorAdapter, EMBEDDING_CONFIG);
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
    const { store, processor, createApprovedMemory } = createHarness({ adapter: vectorAdapter });
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
      const { job } = await processor.enqueueEmbeddingJob({
        ownerUserId: OWNER,
        recordKind: "memory",
        recordId: memory.id,
      });
      await processor.processEmbeddingJob({ jobId: job.id });
    }

    const queries = createSemanticRetrievalQueries(store, vectorAdapter, EMBEDDING_CONFIG);
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
    const { store, processor, createApprovedMemory } = createHarness({ adapter: vectorAdapter });
    const stale = await createApprovedMemory({
      content: "Mara loves cooking classes and handmade kitchen gifts.",
    });
    const suggested = await createApprovedMemory({
      content: "Mara likes stressful puzzle games.",
      status: "suggested",
      approvedAt: null,
    });
    const { job } = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: stale.id,
    });
    await processor.processEmbeddingJob({ jobId: job.id });
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
    const queries = createSemanticRetrievalQueries(store, vectorAdapter, EMBEDDING_CONFIG);

    const results = await queries.searchSemanticContext({
      ownerUserId: OWNER,
      query: "gift ideas",
      limit: 5,
      minimumSimilarity: 0,
      directlyRequested: false,
    });

    expect(results).toEqual([]);
  });

  it("excludes restricted memory embeddings by default and returns them only when directly requested", async () => {
    const { store, createApprovedMemory } = createHarness({ adapter: vectorAdapter });
    const restricted = await createApprovedMemory({
      content: "Mara shared a stressful family situation.",
      sensitivity: "restricted",
    });
    await store.upsertRelationshipContextEmbedding({
      ownerUserId: OWNER,
      personId: restricted.personId,
      recordKind: "memory",
      recordId: restricted.id,
      embedding: vectorFor(restricted.content),
      embeddingModel: EMBEDDING_CONFIG.model,
      embeddingVersion: EMBEDDING_CONFIG.version,
      embeddingDimensions: 4,
      embeddedText: restricted.content,
      contentFingerprint: "manual",
      trustLevel: "confirmed_fact",
      sensitivity: "restricted",
      sourceUpdatedAt: restricted.updatedAt,
    });
    const queries = createSemanticRetrievalQueries(store, vectorAdapter, EMBEDDING_CONFIG);

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
