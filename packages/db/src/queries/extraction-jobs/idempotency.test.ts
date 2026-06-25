import { describe, expect, it } from "vitest";
import { createHarness, OWNER } from "./harness";

describe("extraction job idempotency and retry", () => {
  it("does not create duplicate suggested memories when a completed job is processed again", async () => {
    const { store, processor, createPerson, captureRecord, link } = createHarness();
    const mark = await createPerson("Mark");
    const sourceRecord = await captureRecord({ retainedContent: "Mark moved to Denver." });
    await link(sourceRecord.id, mark.id);
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    await processor.processExtractionJob({ jobId: job.id });
    // Force a re-run by resetting to a claimable state, simulating a redelivery.
    await store.updateExtractionJob({ jobId: job.id, status: "pending", claimedAt: null });
    const second = await processor.processExtractionJob({ jobId: job.id });

    expect(second.suggestedMemories).toHaveLength(0);
    await expect(
      store.listMemoriesForSourceRecord({ sourceRecordId: sourceRecord.id }),
    ).resolves.toHaveLength(1);
  });

  it("marks a failed job retryable and recovers without duplicating already-created memories", async () => {
    const { store, processor, createPerson, captureRecord, auditActions } = createHarness();
    const ada = await createPerson("Ada");
    const bo = await createPerson("Bo");
    const sourceRecord = await captureRecord({ retainedContent: "Dinner with Ada and Bo." });
    await store.linkSourceRecordPerson({
      sourceRecordId: sourceRecord.id,
      personId: ada.id,
      role: "primary",
    });
    await store.linkSourceRecordPerson({
      sourceRecordId: sourceRecord.id,
      personId: bo.id,
      role: "mentioned",
    });
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    // Fail on the second memory creation so the first is persisted but the job fails.
    const realCreateMemory = store.createMemory;
    let calls = 0;
    store.createMemory = async (values) => {
      calls += 1;
      if (calls === 2) {
        throw new Error("transient failure");
      }
      return realCreateMemory(values);
    };

    const failed = await processor.processExtractionJob({ jobId: job.id });
    expect(failed.outcome).toBe("failed");
    expect(failed.job.status).toBe("failed");
    expect(failed.job.lastError).toBe("transient failure");
    await expect(
      store.listMemoriesForSourceRecord({ sourceRecordId: sourceRecord.id }),
    ).resolves.toHaveLength(1);

    // Repair the store and retry; the failed job must be claimable again.
    store.createMemory = realCreateMemory;
    const retried = await processor.processExtractionJob({
      jobId: job.id,
      now: new Date(Date.now() + 10 * 60 * 1000),
    });

    expect(retried.outcome).toBe("completed");
    expect(retried.job.attempts).toBe(2);
    const persisted = await store.listMemoriesForSourceRecord({ sourceRecordId: sourceRecord.id });
    expect(persisted).toHaveLength(2);
    expect(persisted.map((memory) => memory.personId).sort()).toEqual([ada.id, bo.id].sort());
    await expect(auditActions()).resolves.toContain("extraction_job.failed");
  });
});

describe("extraction job partial extraction", () => {
  it("extracts resolved people while facts tied to unresolved mentions wait", async () => {
    const { store, processor, capture, resolution, createPerson } = createHarness();
    const nina = await createPerson("Nina");
    const { sourceRecord } = await capture.captureSourceRecord({
      ownerUserId: OWNER,
      retainedContent: "Nina introduced me to someone; Jordan may join next time.",
      status: "active",
      unresolvedMentions: [{ mentionText: "Jordan", candidatePersonIds: [] }],
    });
    await resolution.linkSourceRecordToExistingPerson({
      ownerUserId: OWNER,
      sourceRecordId: sourceRecord.id,
      personId: nina.id,
      role: "primary",
    });
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    const result = await processor.processExtractionJob({ jobId: job.id });

    expect(result.outcome).toBe("partial");
    // The job stays alive (pending) so resolved mentions extract on a later run.
    expect(result.job.status).toBe("pending");
    expect(result.suggestedMemories).toHaveLength(1);
    expect(result.suggestedMemories[0]?.personId).toBe(nina.id);

    const memories = await store.listMemoriesForSourceRecord({ sourceRecordId: sourceRecord.id });
    expect(memories).toHaveLength(1);
  });

  it("does not re-suggest or re-audit on a no-progress partial re-run", async () => {
    const { store, processor, capture, resolution, createPerson, auditActions } = createHarness();
    const nina = await createPerson("Nina");
    const { sourceRecord } = await capture.captureSourceRecord({
      ownerUserId: OWNER,
      retainedContent: "Nina plus an unresolved Jordan.",
      status: "active",
      unresolvedMentions: [{ mentionText: "Jordan", candidatePersonIds: [] }],
    });
    await resolution.linkSourceRecordToExistingPerson({
      ownerUserId: OWNER,
      sourceRecordId: sourceRecord.id,
      personId: nina.id,
      role: "primary",
    });
    const { job } = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    await processor.processExtractionJob({ jobId: job.id });
    const secondRun = await processor.processExtractionJob({
      jobId: job.id,
      now: new Date(Date.now() + 10 * 60 * 1000),
    });

    expect(secondRun.outcome).toBe("partial");
    expect(secondRun.suggestedMemories).toHaveLength(0);
    await expect(
      store.listMemoriesForSourceRecord({ sourceRecordId: sourceRecord.id }),
    ).resolves.toHaveLength(1);
    // Exactly one partial audit entry — the no-progress re-run stays silent.
    const partialEntries = (await auditActions()).filter(
      (action) => action === "extraction_job.partial",
    );
    expect(partialEntries).toHaveLength(1);
  });
});
