import { describe, expect, it } from "vitest";
import { createHarness, EMBEDDING_CONFIG, OWNER } from "./harness";
import { fingerprintEmbeddedText } from "./processor";

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

  /**
   * The columns beside the vector are denormalized, and the content fingerprint cannot see
   * them: it covers `(recordKind, recordId, embeddedText)` only. Editing a memory's
   * sensitivity leaves every word of the embedded text alone, so the fingerprint still
   * matches and `reuseOrEmbed` short-circuits - which is right for the vector and wrong for
   * the row, unless the reuse converges the metadata too.
   *
   * Without that convergence the drift is permanent, not transient: every later job takes
   * the same short-circuit, so nothing can ever repair the row. The search seam compares
   * `e.sensitivity` against the live record, so the memory drops out of semantic recall for
   * good. This is the same unrecoverable-desync family as the `sourceUpdatedAt` gate that
   * the migration-shape tripwire now forbids.
   */
  it("refreshes denormalized sensitivity on a reused embedding instead of leaving it drifted", async () => {
    let adapterCalls = 0;
    const { store, processor, createApprovedMemory } = createHarness({
      adapter: {
        async embedText(request) {
          adapterCalls += 1;
          return { vector: [1, 0, 0, 0], model: request.model, version: request.version };
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
    const edited = await store.updateMemory({
      ownerUserId: OWNER,
      memoryId: memory.id,
      patch: { sensitivity: "sensitive" },
    });
    const secondJob = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: edited.id,
    });

    const second = await processor.processEmbeddingJob({ jobId: secondJob.job.id });

    expect(first.embedding?.sensitivity).toBe("normal");
    expect(second.embedding?.sensitivity).toBe("sensitive");
    // Converged in place: same row, same vector, same fingerprint, no second adapter call.
    expect(second.embedding?.id).toBe(first.embedding?.id);
    expect(second.embedding?.embedding).toEqual(first.embedding?.embedding);
    expect(second.embedding?.contentFingerprint).toBe(first.embedding?.contentFingerprint);
    expect(adapterCalls).toBe(1);
    await expect(store.listRelationshipContextEmbeddings()).resolves.toHaveLength(1);
  });

  /**
   * Sensitivity is not the only column the fingerprint cannot see. Person linkage is
   * denormalized onto the row too and is read by the person-scoped search filter, so it has
   * to converge on the same seam - planted here directly, because the fingerprint's whole
   * point is that no source edit can produce this state on its own.
   */
  it("refreshes denormalized person linkage on a reused embedding", async () => {
    let adapterCalls = 0;
    const { store, processor, createPerson, createApprovedMemory } = createHarness({
      adapter: {
        async embedText(request) {
          adapterCalls += 1;
          return { vector: [1, 0, 0, 0], model: request.model, version: request.version };
        },
      },
    });
    const memory = await createApprovedMemory();
    const otherPerson = await createPerson("Sam Rivera");
    await store.upsertRelationshipContextEmbedding({
      ownerUserId: OWNER,
      personId: otherPerson.id,
      recordKind: "memory",
      recordId: memory.id,
      embedding: [1, 0, 0, 0],
      embeddingModel: EMBEDDING_CONFIG.model,
      embeddingVersion: EMBEDDING_CONFIG.version,
      embeddingDimensions: 4,
      embeddedText: memory.content,
      contentFingerprint: fingerprintEmbeddedText({
        recordKind: "memory",
        recordId: memory.id,
        embeddedText: memory.content,
      }),
      trustLevel: "confirmed_fact",
      sensitivity: "normal",
      sourceUpdatedAt: memory.updatedAt,
    });
    const { job } = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: memory.id,
    });

    const result = await processor.processEmbeddingJob({ jobId: job.id });

    expect(result.outcome).toBe("completed");
    expect(result.embedding?.personId).toBe(memory.personId);
    expect(adapterCalls).toBe(0);
  });

  /**
   * A skip is a verdict on the state the record was in, not a permanent one: the reasons
   * are reversible (a suggestion is approved, a mention is resolved, a restriction is
   * lifted). Re-enqueueing is how this pipeline is told that state changed, so the same job
   * reopens to be re-decided - it does not fork a second job, and it does not stay terminal
   * and quietly keep the record out of retrieval forever.
   */
  it("reopens a skipped job when the record is enqueued again", async () => {
    const { processor, store, createApprovedMemory } = createHarness();
    const suggested = await createApprovedMemory({ status: "suggested", approvedAt: null });
    const { job } = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: suggested.id,
    });

    const skipped = await processor.processEmbeddingJob({ jobId: job.id });
    const approved = await store.updateMemory({
      ownerUserId: OWNER,
      memoryId: suggested.id,
      patch: { status: "approved", approvedAt: new Date() },
    });
    const retried = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: approved.id,
    });
    const reprocessed = await processor.processEmbeddingJob({ jobId: retried.job.id });

    expect(skipped.outcome).toBe("skipped");
    expect(retried.created).toBe(false);
    expect(retried.job.id).toBe(job.id);
    expect(retried.job.status).toBe("pending");
    expect(reprocessed.outcome).toBe("completed");
    await expect(store.listEmbeddingJobs()).resolves.toHaveLength(1);
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
