import { describe, expect, it } from "vitest";
import { createHarness, EMBEDDING_CONFIG, OWNER } from "./harness";

describe("semantic embedding jobs - approved memories", () => {
  it("enqueues approved-memory embedding work idempotently without calling the adapter", async () => {
    let adapterCalls = 0;
    const { processor, createApprovedMemory } = createHarness({
      adapter: {
        async embedText(request) {
          adapterCalls += 1;
          return { vector: [1, 0, 0, 0], model: request.model, version: request.version };
        },
      },
    });
    const memory = await createApprovedMemory();

    const first = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: memory.id,
    });
    const second = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: memory.id,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(first.job.status).toBe("pending");
    expect(first.job.attempts).toBe(0);
    expect(first.job.idempotencyKey).toContain(memory.id);
    expect(adapterCalls).toBe(0);
  });

  it("claims and completes a due job with a current approved-memory embedding row", async () => {
    const { store, processor, createApprovedMemory, auditActions } = createHarness();
    const memory = await createApprovedMemory();
    const { job } = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: memory.id,
    });

    const result = await processor.processEmbeddingJob({ jobId: job.id });

    expect(result.outcome).toBe("completed");
    expect(result.job.status).toBe("completed");
    expect(result.job.attempts).toBe(1);
    expect(result.embedding).toEqual(
      expect.objectContaining({
        ownerUserId: OWNER,
        personId: memory.personId,
        recordKind: "memory",
        recordId: memory.id,
        embedding: [0.1, 0.2, 0.3, 0.4],
        embeddingModel: EMBEDDING_CONFIG.model,
        embeddingVersion: EMBEDDING_CONFIG.version,
        embeddingDimensions: 4,
        embeddedText: "Mara prefers handmade cooking gifts.",
        trustLevel: "confirmed_fact",
        sensitivity: "normal",
      }),
    );

    await expect(store.listRelationshipContextEmbeddings()).resolves.toHaveLength(1);
    await expect(auditActions()).resolves.toEqual(
      expect.arrayContaining(["embedding_job.enqueue", "embedding_job.completed"]),
    );
  });

  it("skips ineligible memories without creating an embedding", async () => {
    const { store, processor, createApprovedMemory } = createHarness();
    const suggested = await createApprovedMemory({ status: "suggested", approvedAt: null });
    const restricted = await createApprovedMemory({
      content: "Mara shared restricted health context.",
      sensitivity: "restricted",
    });

    const suggestedJob = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: suggested.id,
    });
    const restrictedJob = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: restricted.id,
    });

    const suggestedResult = await processor.processEmbeddingJob({ jobId: suggestedJob.job.id });
    const restrictedResult = await processor.processEmbeddingJob({ jobId: restrictedJob.job.id });

    expect(suggestedResult).toEqual(
      expect.objectContaining({ outcome: "skipped", reason: "memory_not_approved" }),
    );
    expect(restrictedResult).toEqual(
      expect.objectContaining({ outcome: "skipped", reason: "restricted_content" }),
    );
    await expect(store.listRelationshipContextEmbeddings()).resolves.toEqual([]);
  });

  it("replaces stale current rows in place when approved memory content changes", async () => {
    let vectorSeed = 0;
    const { store, processor, createApprovedMemory } = createHarness({
      adapter: {
        async embedText(request) {
          vectorSeed += 1;
          return {
            vector: [vectorSeed, 0, 0, 0],
            model: request.model,
            version: request.version,
          };
        },
      },
    });
    const memory = await createApprovedMemory();
    const firstJob = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: memory.id,
    });
    const first = await processor.processEmbeddingJob({ jobId: firstJob.job.id });
    const updatedMemory = await store.updateMemory({
      ownerUserId: OWNER,
      memoryId: memory.id,
      patch: {
        content: "Mara prefers ceramic cooking gifts.",
      },
    });
    const secondJob = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: updatedMemory.id,
    });

    const second = await processor.processEmbeddingJob({ jobId: secondJob.job.id });
    const embeddings = await store.listRelationshipContextEmbeddings();

    expect(embeddings).toHaveLength(1);
    expect(second.embedding?.id).toBe(first.embedding?.id);
    expect(second.embedding?.embeddedText).toBe("Mara prefers ceramic cooking gifts.");
    expect(second.embedding?.embedding).toEqual([2, 0, 0, 0]);
    expect(second.embedding?.contentFingerprint).not.toBe(first.embedding?.contentFingerprint);
  });

  it("does not re-embed when only non-embedded metadata changes", async () => {
    let adapterCalls = 0;
    const { store, processor, createApprovedMemory } = createHarness({
      adapter: {
        async embedText(request) {
          adapterCalls += 1;
          return {
            vector: [adapterCalls, 0, 0, 0],
            model: request.model,
            version: request.version,
          };
        },
      },
    });
    const memory = await createApprovedMemory();
    const firstJob = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: memory.id,
    });
    const first = await processor.processEmbeddingJob({ jobId: firstJob.job.id });
    const updatedMemory = await store.updateMemory({
      ownerUserId: OWNER,
      memoryId: memory.id,
      patch: { importance: 5 },
    });
    const secondJob = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: updatedMemory.id,
    });

    const second = await processor.processEmbeddingJob({ jobId: secondJob.job.id });

    expect(adapterCalls).toBe(1);
    expect(second.embedding?.id).toBe(first.embedding?.id);
    expect(second.embedding?.contentFingerprint).toBe(first.embedding?.contentFingerprint);
  });

  it("keeps skipped ineligible jobs terminal when enqueue is retried", async () => {
    const { processor, createApprovedMemory } = createHarness();
    const suggested = await createApprovedMemory({ status: "suggested", approvedAt: null });
    const { job } = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: suggested.id,
    });

    const skipped = await processor.processEmbeddingJob({ jobId: job.id });
    const retried = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: suggested.id,
    });

    expect(skipped.outcome).toBe("skipped");
    expect(retried.created).toBe(false);
    expect(retried.job.status).toBe("skipped");
  });

  it("retries after adapter failure without duplicating completed work", async () => {
    let shouldFail = true;
    const { store, processor, createApprovedMemory } = createHarness({
      adapter: {
        async embedText(request) {
          if (shouldFail) {
            throw new Error("adapter unavailable");
          }
          return { vector: [0, 1, 0, 0], model: request.model, version: request.version };
        },
      },
    });
    const memory = await createApprovedMemory();
    const { job } = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: memory.id,
    });

    const failed = await processor.processEmbeddingJob({ jobId: job.id, retryDelayMs: 1 });
    shouldFail = false;
    const retry = await processor.processEmbeddingJob({
      jobId: job.id,
      now: new Date(Date.now() + 5),
    });

    expect(failed).toEqual(
      expect.objectContaining({ outcome: "failed", error: "adapter unavailable" }),
    );
    expect(retry.outcome).toBe("completed");
    expect(retry.job.attempts).toBe(2);
    await expect(store.listRelationshipContextEmbeddings()).resolves.toHaveLength(1);
  });
});
