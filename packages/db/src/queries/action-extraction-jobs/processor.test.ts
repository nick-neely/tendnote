import { createFakeSuggestedActionExtractionAdapter } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createHarness, enqueueAndProcess, OWNER } from "./harness";

describe("action extraction job lifecycle", () => {
  it("proposes a review-gated Suggested General Action grounded in the source record", async () => {
    const adapter = createFakeSuggestedActionExtractionAdapter([
      { title: "Replace the refrigerator water filter", reason: "It is overdue" },
    ]);
    const { processor, captureRecord, listActionsForSource } = createHarness({
      extractionAdapter: adapter,
    });
    const source = await captureRecord();
    const { job, created } = await processor.enqueueActionExtractionJob({
      sourceRecordId: source.id,
    });
    expect(created).toBe(true);

    const result = await processor.processActionExtractionJob({ jobId: job.id });

    expect(result.outcome).toBe("completed");
    expect(result.job.status).toBe("completed");
    expect(result.suggestedActionIds).toHaveLength(1);

    const actions = await listActionsForSource(source.id);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.status).toBe("suggested");
    expect(actions[0]?.scope).toBe("private");
    expect(actions[0]?.sourceRecordId).toBe(source.id);
    expect(actions[0]?.notes).toBe("It is overdue");
    expect(actions[0]?.createdByUserId).toBe(OWNER);
  });

  it("enqueue is idempotent: one action job per source record", async () => {
    const { processor, captureRecord } = createHarness();
    const source = await captureRecord();

    const first = await processor.enqueueActionExtractionJob({ sourceRecordId: source.id });
    const second = await processor.enqueueActionExtractionJob({ sourceRecordId: source.id });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
  });

  it("skips a source record that is not active without proposing anything", async () => {
    const adapter = createFakeSuggestedActionExtractionAdapter([{ title: "Do a thing" }]);
    const { processor, captureRecord, listActionsForSource } = createHarness({
      extractionAdapter: adapter,
    });
    const source = await captureRecord({ status: "archived" });
    const { job } = await processor.enqueueActionExtractionJob({ sourceRecordId: source.id });

    const result = await processor.processActionExtractionJob({ jobId: job.id });

    expect(result.outcome).toBe("skipped");
    expect(result.reason).toBe("source_record_not_active");
    expect(result.job.status).toBe("skipped");
    await expect(listActionsForSource(source.id)).resolves.toHaveLength(0);
  });

  it("skips restricted content unless directly requested", async () => {
    const adapter = createFakeSuggestedActionExtractionAdapter([{ title: "Do a thing" }]);
    const { processor, captureRecord, listActionsForSource } = createHarness({
      extractionAdapter: adapter,
    });
    const source = await captureRecord({ sensitivity: "restricted" });
    const { job } = await processor.enqueueActionExtractionJob({ sourceRecordId: source.id });

    const skipped = await processor.processActionExtractionJob({ jobId: job.id });
    expect(skipped.outcome).toBe("skipped");
    expect(skipped.reason).toBe("restricted_content");
    await expect(listActionsForSource(source.id)).resolves.toHaveLength(0);

    // A direct request lets a restricted record extract.
    const fresh = await captureRecord({ sensitivity: "restricted" });
    const { job: job3 } = await processor.enqueueActionExtractionJob({ sourceRecordId: fresh.id });
    const freshResult = await processor.processActionExtractionJob({
      jobId: job3.id,
      directlyRequested: true,
    });
    expect(freshResult.outcome).toBe("completed");
    await expect(listActionsForSource(fresh.id)).resolves.toHaveLength(1);
  });

  it("proposes nothing (but completes) when the adapter returns no candidates", async () => {
    const adapter = createFakeSuggestedActionExtractionAdapter([]);
    const { processor, captureRecord, listActionsForSource } = createHarness({
      extractionAdapter: adapter,
    });
    const source = await captureRecord();

    const result = await enqueueAndProcess(processor, source.id);

    expect(result.outcome).toBe("completed");
    expect(result.suggestedActionIds).toHaveLength(0);
    await expect(listActionsForSource(source.id)).resolves.toHaveLength(0);
  });

  it("marks a failed job retryable and recovers without duplicating already-created proposals", async () => {
    const adapter = createFakeSuggestedActionExtractionAdapter([
      { title: "First action" },
      { title: "Second action" },
    ]);
    const { store, processor, captureRecord, listActionsForSource } = createHarness({
      extractionAdapter: adapter,
    });
    const source = await captureRecord();
    const { job } = await processor.enqueueActionExtractionJob({ sourceRecordId: source.id });

    // Fail on the second proposal so the first is persisted but the job fails.
    const realCreate = store.createGeneralAction;
    let calls = 0;
    store.createGeneralAction = async (values) => {
      calls += 1;
      if (calls === 2) {
        throw new Error("transient failure");
      }
      return realCreate(values);
    };

    const failed = await processor.processActionExtractionJob({ jobId: job.id });
    expect(failed.outcome).toBe("failed");
    expect(failed.job.status).toBe("failed");
    expect(failed.job.lastError).toBe("transient failure");
    await expect(listActionsForSource(source.id)).resolves.toHaveLength(1);

    // Repair and retry after the backoff; the failed job must be claimable again and must
    // not re-propose the action that already exists.
    store.createGeneralAction = realCreate;
    const retried = await processor.processActionExtractionJob({
      jobId: job.id,
      now: new Date(Date.now() + 10 * 60 * 1000),
    });

    expect(retried.outcome).toBe("completed");
    expect(retried.job.attempts).toBe(2);
    const actions = await listActionsForSource(source.id);
    expect(actions.map((action) => action.title).sort()).toEqual(["First action", "Second action"]);
  });

  it("does not re-claim a completed job", async () => {
    const adapter = createFakeSuggestedActionExtractionAdapter([{ title: "Only once" }]);
    const { processor, captureRecord } = createHarness({ extractionAdapter: adapter });
    const source = await captureRecord();
    const { job } = await processor.enqueueActionExtractionJob({ sourceRecordId: source.id });

    await processor.processActionExtractionJob({ jobId: job.id });
    const second = await processor.processActionExtractionJob({ jobId: job.id });

    expect(second.outcome).toBe("not_claimable");
  });
});
