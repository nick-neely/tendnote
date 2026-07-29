import { describe, expect, it } from "vitest";
import { createHarness, OWNER } from "./harness";

describe("stale embedding job recovery", () => {
  it("reopens only expired runs and records the recovery", async () => {
    const { store, processor, createApprovedMemory } = createHarness();
    const staleMemory = await createApprovedMemory({ content: "Mara likes cooking gifts." });
    const liveMemory = await createApprovedMemory({ content: "Mara has career updates." });
    const startedAt = new Date("2026-07-29T12:00:00.000Z");
    const recoveredAt = new Date("2026-07-29T12:10:00.000Z");

    const stale = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: staleMemory.id,
      runAfter: startedAt,
    });
    const live = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: liveMemory.id,
      runAfter: startedAt,
    });
    await store.claimEmbeddingJob({ jobId: stale.job.id, now: startedAt });
    await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: staleMemory.id,
    });
    await store.claimEmbeddingJob({
      jobId: live.job.id,
      now: new Date(startedAt.getTime() + 1),
    });

    const result = await processor.recoverStaleEmbeddingJobs({
      now: recoveredAt,
      limit: 5,
      leaseDurationMs: 600_000,
    });

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({
      id: stale.job.id,
      status: "pending",
      claimedAt: null,
      completedAt: null,
      lastError: "Recovered after the embedding claim lease expired.",
      rerunRequestedAt: null,
      runAfter: recoveredAt,
    });
    await expect(store.getEmbeddingJob(live.job.id)).resolves.toMatchObject({
      status: "running",
    });
    await expect(store.listAuditLogEntries({ ownerUserId: OWNER })).resolves.toContainEqual(
      expect.objectContaining({
        action: "embedding_job.recovered",
        entityType: "relationship_context_embedding_job",
        entityId: stale.job.id,
        metadataJson: expect.objectContaining({
          recordKind: "memory",
          recordId: staleMemory.id,
          leaseDurationMs: 600_000,
        }),
      }),
    );
  });

  it("bounds each recovery pass", async () => {
    const { store, processor, createApprovedMemory } = createHarness();
    const startedAt = new Date("2026-07-29T12:00:00.000Z");
    const recoveredAt = new Date("2026-07-29T12:20:00.000Z");

    for (const content of ["Mara likes cooking gifts.", "Mara has career updates."]) {
      const memory = await createApprovedMemory({ content });
      const { job } = await processor.enqueueEmbeddingJob({
        ownerUserId: OWNER,
        recordKind: "memory",
        recordId: memory.id,
        runAfter: startedAt,
      });
      await store.claimEmbeddingJob({ jobId: job.id, now: startedAt });
    }

    const result = await processor.recoverStaleEmbeddingJobs({
      now: recoveredAt,
      limit: 1,
      leaseDurationMs: 600_000,
    });

    expect(result.jobs).toHaveLength(1);
    expect(
      (await store.listEmbeddingJobs()).filter((job) => job.status === "running"),
    ).toHaveLength(1);
  });

  it("does not let the expired worker settle a replacement run", async () => {
    const { store, processor, createApprovedMemory } = createHarness();
    const memory = await createApprovedMemory();
    const firstClaimedAt = new Date("2026-07-29T12:00:00.000Z");
    const recoveredAt = new Date("2026-07-29T12:10:00.000Z");
    const secondClaimedAt = new Date("2026-07-29T12:10:01.000Z");
    const { job } = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: memory.id,
      runAfter: firstClaimedAt,
    });
    await store.claimEmbeddingJob({ jobId: job.id, now: firstClaimedAt });
    await processor.recoverStaleEmbeddingJobs({ now: recoveredAt, leaseDurationMs: 600_000 });
    await store.claimEmbeddingJob({ jobId: job.id, now: secondClaimedAt });

    const staleVerdict = await store.settleEmbeddingJob({
      jobId: job.id,
      status: "completed",
      now: secondClaimedAt,
      expectedClaimedAt: firstClaimedAt,
      claimedAt: null,
      completedAt: secondClaimedAt,
    });

    expect(staleVerdict).toMatchObject({
      settled: false,
      job: {
        status: "running",
        claimedAt: secondClaimedAt,
      },
    });
  });

  it("leaves the recovery visible on the job when audit persistence fails", async () => {
    const { store, processor, createApprovedMemory } = createHarness();
    const startedAt = new Date("2026-07-29T12:00:00.000Z");
    const recoveredAt = new Date("2026-07-29T12:10:00.000Z");
    const memory = await createApprovedMemory();
    const { job } = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: memory.id,
      runAfter: startedAt,
    });
    await store.claimEmbeddingJob({ jobId: job.id, now: startedAt });
    store.createAuditLogEntry = async () => {
      throw new Error("audit unavailable");
    };

    await expect(
      processor.recoverStaleEmbeddingJobs({
        now: recoveredAt,
        leaseDurationMs: 600_000,
      }),
    ).rejects.toThrow("audit unavailable");

    await expect(store.getEmbeddingJob(job.id)).resolves.toMatchObject({
      status: "pending",
      lastError: "Recovered after the embedding claim lease expired.",
    });
  });

  it("suppresses the expired pass's terminal outcome and audit", async () => {
    let releaseEmbedding!: () => void;
    let markEmbeddingStarted!: () => void;
    const embeddingMayFinish = new Promise<void>((resolve) => {
      releaseEmbedding = resolve;
    });
    const embeddingStarted = new Promise<void>((resolve) => {
      markEmbeddingStarted = resolve;
    });
    const { store, processor, createApprovedMemory } = createHarness({
      adapter: {
        async embedText(input) {
          markEmbeddingStarted();
          await embeddingMayFinish;
          return { vector: [1, 0, 0, 0], model: input.model, version: input.version };
        },
      },
    });
    const firstClaimedAt = new Date("2026-07-29T12:00:00.000Z");
    const recoveredAt = new Date("2026-07-29T12:10:00.000Z");
    const secondClaimedAt = new Date("2026-07-29T12:10:01.000Z");
    const memory = await createApprovedMemory();
    const { job } = await processor.enqueueEmbeddingJob({
      ownerUserId: OWNER,
      recordKind: "memory",
      recordId: memory.id,
      runAfter: firstClaimedAt,
    });

    const expiredPass = processor.processEmbeddingJob({ jobId: job.id, now: firstClaimedAt });
    await embeddingStarted;
    await processor.recoverStaleEmbeddingJobs({
      now: recoveredAt,
      leaseDurationMs: 600_000,
    });
    await store.claimEmbeddingJob({ jobId: job.id, now: secondClaimedAt });
    releaseEmbedding();

    await expect(expiredPass).resolves.toMatchObject({
      outcome: "not_claimable",
      embedding: null,
      job: { status: "running", claimedAt: secondClaimedAt },
    });
    const audit = await store.listAuditLogEntries({ ownerUserId: OWNER });
    expect(audit.filter((entry) => entry.action === "embedding_job.completed")).toEqual([]);
  });
});
