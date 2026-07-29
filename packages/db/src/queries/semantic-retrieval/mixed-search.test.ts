import { projectSourceRecordEmbeddedText } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import {
  createHarness,
  EMBEDDING_CONFIG,
  OWNER,
  topicVectorAdapter,
  topicVectorFor,
} from "./harness";
import { createSemanticRetrievalQueries } from "./queries";

describe("semantic retrieval - mixed memory and source-record results", () => {
  it("returns approved memories and eligible source records through one query", async () => {
    const {
      store,
      processor,
      createApprovedMemory,
      createPerson,
      createSourceRecord,
      linkSourceRecord,
    } = createHarness({ adapter: topicVectorAdapter });
    const memory = await createApprovedMemory({
      content: "Mara loves cooking classes and handmade kitchen gifts.",
      importance: 4,
    });
    const person = await createPerson("Mara Lin");
    const sourceRecord = await createSourceRecord({
      content: "Mara wrote down handmade kitchen gift ideas.",
      importance: 3,
    });
    await linkSourceRecord(sourceRecord.id, person.id);

    for (const record of [
      { recordKind: "memory" as const, recordId: memory.id },
      { recordKind: "source_record" as const, recordId: sourceRecord.id },
    ]) {
      const { job } = await processor.enqueueEmbeddingJob({ ownerUserId: OWNER, ...record });
      await processor.processEmbeddingJob({ jobId: job.id });
    }

    const queries = createSemanticRetrievalQueries(store, topicVectorAdapter, EMBEDDING_CONFIG);
    const results = await queries.searchSemanticContext({
      ownerUserId: OWNER,
      query: "gift ideas",
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
        trustLevel: "confirmed_fact",
        sensitivity: "normal",
        sourceRefs: [{ kind: "memory", id: memory.id }],
      }),
      expect.objectContaining({
        recordKind: "source_record",
        recordId: sourceRecord.id,
        relatedPersonId: person.id,
        relatedPersonDisplayName: "Mara Lin",
        snippet: "Mara wrote down handmade kitchen gift ideas.",
        trustLevel: "logged_context",
        sensitivity: "normal",
        visibilityChoice: "only_me",
        visibilityLabel: "Only me",
        sourceRefs: [{ kind: "source_record", id: sourceRecord.id }],
      }),
    ]);
  });

  it("applies record-kind and person filters across mixed results", async () => {
    const {
      store,
      processor,
      createApprovedMemory,
      createPerson,
      createSourceRecord,
      linkSourceRecord,
    } = createHarness({ adapter: topicVectorAdapter });
    const maraMemory = await createApprovedMemory({
      content: "Mara loves cooking classes and handmade kitchen gifts.",
    });
    const mara = await store.getPerson({ ownerUserId: OWNER, personId: maraMemory.personId });
    const jules = await createPerson("Jules Park");
    const sourceRecord = await createSourceRecord({
      content: "Jules wants a cooking class gift.",
    });
    await linkSourceRecord(sourceRecord.id, jules.id);

    for (const record of [
      { recordKind: "memory" as const, recordId: maraMemory.id },
      { recordKind: "source_record" as const, recordId: sourceRecord.id },
    ]) {
      const { job } = await processor.enqueueEmbeddingJob({ ownerUserId: OWNER, ...record });
      await processor.processEmbeddingJob({ jobId: job.id });
    }

    const queries = createSemanticRetrievalQueries(store, topicVectorAdapter, EMBEDDING_CONFIG);
    const maraOnly = await queries.searchSemanticContext({
      ownerUserId: OWNER,
      query: "gift ideas",
      personId: maraMemory.personId,
      limit: 5,
      minimumSimilarity: 0,
      directlyRequested: false,
    });
    const sourceOnly = await queries.searchSemanticContext({
      ownerUserId: OWNER,
      query: "gift ideas",
      recordKinds: ["source_record"],
      limit: 5,
      minimumSimilarity: 0,
      directlyRequested: false,
    });

    expect(mara?.displayName).toBe("Mara Lin");
    expect(maraOnly.map((result) => result.recordId)).toEqual([maraMemory.id]);
    expect(sourceOnly.map((result) => result.recordId)).toEqual([sourceRecord.id]);
  });

  it("matches source records for any linked person and routes to the requested person", async () => {
    const { store, processor, createPerson, createSourceRecord, linkSourceRecord } = createHarness({
      adapter: topicVectorAdapter,
    });
    const mara = await createPerson("Mara Lin");
    const jules = await createPerson("Jules Park");
    const sourceRecord = await createSourceRecord({
      content: "Mara and Jules discussed cooking class gift ideas.",
    });
    await linkSourceRecord(sourceRecord.id, mara.id);
    await store.linkSourceRecordPerson({
      sourceRecordId: sourceRecord.id,
      personId: jules.id,
      role: "mentioned",
    });
    const { job } = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "source_record",
      recordId: sourceRecord.id,
    });
    await processor.processEmbeddingJob({ jobId: job.id });

    const queries = createSemanticRetrievalQueries(store, topicVectorAdapter, EMBEDDING_CONFIG);
    const results = await queries.searchSemanticContext({
      ownerUserId: OWNER,
      query: "gift ideas",
      personId: jules.id,
      recordKinds: ["source_record"],
      limit: 5,
      minimumSimilarity: 0,
      directlyRequested: false,
    });

    expect(results).toEqual([
      expect.objectContaining({
        recordKind: "source_record",
        recordId: sourceRecord.id,
        relatedPersonId: jules.id,
        relatedPersonDisplayName: "Jules Park",
        routing: {
          personId: jules.id,
          recordKind: "source_record",
          recordId: sourceRecord.id,
        },
      }),
    ]);
  });

  /**
   * The source-record half of the same guarantee the memory suite pins: a touch that leaves
   * the projected text alone must not evict the record from semantic retrieval. Writing an
   * unrelated metadata key bumps `updatedAt` while People / Interaction type / Logged
   * context all still project to the exact string that was embedded.
   *
   * Observed in the dev database before the fix: source records whose `updatedAt` had been
   * bumped a few hundred milliseconds after their embedding was written - by the person
   * linking that follows capture - were permanently unreachable through semantic recall.
   */
  it("keeps retrieving a source record whose sourceUpdatedAt trails its updatedAt", async () => {
    const { store, createPerson, createSourceRecord, linkSourceRecord } = createHarness({
      adapter: topicVectorAdapter,
    });
    const person = await createPerson("Mara Lin");
    const sourceRecord = await createSourceRecord({
      content: "Mara wrote down handmade kitchen gift ideas.",
    });
    await linkSourceRecord(sourceRecord.id, person.id);
    await store.upsertRelationshipContextEmbedding({
      ownerUserId: OWNER,
      personId: person.id,
      recordKind: "source_record",
      recordId: sourceRecord.id,
      embedding: topicVectorFor(sourceRecord.content),
      embeddingModel: EMBEDDING_CONFIG.model,
      embeddingVersion: EMBEDDING_CONFIG.version,
      embeddingDimensions: 4,
      // Unchanged: People / Interaction type / Logged context all still project to this.
      embeddedText: projectSourceRecordEmbeddedText(sourceRecord, [
        { id: person.id, displayName: person.displayName },
      ]),
      contentFingerprint: "manual-lagging-source-updated-at",
      trustLevel: "logged_context",
      sensitivity: "normal",
      // A whole second behind, standing in for the real drift seen in the dev database:
      // the person linking that follows capture bumps `updated_at` a few hundred
      // milliseconds after the embedding row was written.
      sourceUpdatedAt: new Date(sourceRecord.updatedAt.getTime() - 1000),
    });
    const queries = createSemanticRetrievalQueries(store, topicVectorAdapter, EMBEDDING_CONFIG);

    const results = await queries.searchSemanticContext({
      ownerUserId: OWNER,
      query: "gift ideas",
      limit: 5,
      minimumSimilarity: 0,
      directlyRequested: false,
    });

    expect(results.map((result) => result.recordId)).toEqual([sourceRecord.id]);
  });

  it("fails open for incompatible, stale, and ineligible mixed embeddings", async () => {
    const {
      store,
      processor,
      createApprovedMemory,
      createPerson,
      createSourceRecord,
      linkSourceRecord,
    } = createHarness({ adapter: topicVectorAdapter });
    const suggested = await createApprovedMemory({
      content: "Mara likes cooking gifts.",
      status: "suggested",
      approvedAt: null,
    });
    const person = await createPerson("Mara Lin");
    const staleSource = await createSourceRecord({
      content: "Mara likes cooking gifts.",
    });
    const oldVersionSource = await createSourceRecord({
      content: "Mara keeps a cooking gift list.",
    });
    const restrictedSource = await createSourceRecord({
      content: "Mara has stressful private context.",
      sensitivity: "restricted",
    });
    const wrongTrustMemory = await createApprovedMemory({
      content: "Mara has another cooking gift idea.",
    });
    const wrongTrustSource = await createSourceRecord({
      content: "Mara noted another cooking gift idea.",
    });
    await linkSourceRecord(staleSource.id, person.id);
    await linkSourceRecord(oldVersionSource.id, person.id);
    await linkSourceRecord(restrictedSource.id, person.id);
    await linkSourceRecord(wrongTrustSource.id, person.id);

    const { job } = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "source_record",
      recordId: staleSource.id,
    });
    await processor.processEmbeddingJob({ jobId: job.id });
    await store.updateSourceRecordStatus({
      ownerUserId: OWNER,
      sourceRecordId: staleSource.id,
      status: "archived",
    });
    await store.upsertRelationshipContextEmbedding({
      ownerUserId: OWNER,
      personId: suggested.personId,
      recordKind: "memory",
      recordId: suggested.id,
      embedding: topicVectorFor(suggested.content),
      embeddingModel: EMBEDDING_CONFIG.model,
      embeddingVersion: EMBEDDING_CONFIG.version,
      embeddingDimensions: 4,
      embeddedText: suggested.content,
      contentFingerprint: "manual-suggested",
      trustLevel: "confirmed_fact",
      sensitivity: "normal",
      sourceUpdatedAt: suggested.updatedAt,
    });
    await store.upsertRelationshipContextEmbedding({
      ownerUserId: OWNER,
      personId: person.id,
      recordKind: "source_record",
      recordId: oldVersionSource.id,
      embedding: topicVectorFor(oldVersionSource.content),
      embeddingModel: EMBEDDING_CONFIG.model,
      embeddingVersion: "old-version",
      embeddingDimensions: 4,
      embeddedText: projectSourceRecordEmbeddedText(oldVersionSource, [
        { id: person.id, displayName: person.displayName },
      ]),
      contentFingerprint: "manual-old-version",
      trustLevel: "logged_context",
      sensitivity: "normal",
      sourceUpdatedAt: oldVersionSource.updatedAt,
    });
    await store.upsertRelationshipContextEmbedding({
      ownerUserId: OWNER,
      personId: person.id,
      recordKind: "source_record",
      recordId: restrictedSource.id,
      embedding: topicVectorFor(restrictedSource.content),
      embeddingModel: EMBEDDING_CONFIG.model,
      embeddingVersion: EMBEDDING_CONFIG.version,
      embeddingDimensions: 4,
      embeddedText: projectSourceRecordEmbeddedText(restrictedSource, [
        { id: person.id, displayName: person.displayName },
      ]),
      contentFingerprint: "manual-restricted",
      trustLevel: "logged_context",
      sensitivity: "restricted",
      sourceUpdatedAt: restrictedSource.updatedAt,
    });
    await store.upsertRelationshipContextEmbedding({
      ownerUserId: OWNER,
      personId: wrongTrustMemory.personId,
      recordKind: "memory",
      recordId: wrongTrustMemory.id,
      embedding: topicVectorFor(wrongTrustMemory.content),
      embeddingModel: EMBEDDING_CONFIG.model,
      embeddingVersion: EMBEDDING_CONFIG.version,
      embeddingDimensions: 4,
      embeddedText: wrongTrustMemory.content,
      contentFingerprint: "manual-wrong-memory-trust",
      trustLevel: "logged_context",
      sensitivity: "normal",
      sourceUpdatedAt: wrongTrustMemory.updatedAt,
    });
    await store.upsertRelationshipContextEmbedding({
      ownerUserId: OWNER,
      personId: person.id,
      recordKind: "source_record",
      recordId: wrongTrustSource.id,
      embedding: topicVectorFor(wrongTrustSource.content),
      embeddingModel: EMBEDDING_CONFIG.model,
      embeddingVersion: EMBEDDING_CONFIG.version,
      embeddingDimensions: 4,
      embeddedText: projectSourceRecordEmbeddedText(wrongTrustSource, [
        { id: person.id, displayName: person.displayName },
      ]),
      contentFingerprint: "manual-wrong-source-trust",
      trustLevel: "confirmed_fact",
      sensitivity: "normal",
      sourceUpdatedAt: wrongTrustSource.updatedAt,
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

  it("keeps similarity primary and bounds mixed result counts", async () => {
    const {
      store,
      processor,
      createApprovedMemory,
      createPerson,
      createSourceRecord,
      linkSourceRecord,
    } = createHarness({ adapter: topicVectorAdapter });
    const giftMemory = await createApprovedMemory({
      content: "Mara loves cooking classes and handmade kitchen gifts.",
      importance: 1,
    });
    const careerMemory = await createApprovedMemory({
      content: "Mara is considering a career move into backend leadership.",
      importance: 5,
    });
    const person = await createPerson("Mara Lin");
    const giftSource = await createSourceRecord({
      content: "Mara saved another cooking gift idea.",
      importance: 4,
    });
    await linkSourceRecord(giftSource.id, person.id);

    for (const record of [
      { recordKind: "memory" as const, recordId: careerMemory.id },
      { recordKind: "source_record" as const, recordId: giftSource.id },
      { recordKind: "memory" as const, recordId: giftMemory.id },
    ]) {
      const { job } = await processor.enqueueEmbeddingJob({ ownerUserId: OWNER, ...record });
      await processor.processEmbeddingJob({ jobId: job.id });
    }

    const queries = createSemanticRetrievalQueries(store, topicVectorAdapter, EMBEDDING_CONFIG);
    const results = await queries.searchSemanticContext({
      ownerUserId: OWNER,
      query: "gift ideas",
      limit: 2,
      minimumSimilarity: 0,
      directlyRequested: false,
    });

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.recordId)).toEqual([giftSource.id, giftMemory.id]);
  });
});
