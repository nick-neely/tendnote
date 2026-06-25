import { describe, expect, it } from "vitest";
import { createHarness } from "./harness";

describe("extraction job enqueue", () => {
  it("enqueues a pending Postgres-owned job for an eligible source record", async () => {
    const { processor, captureRecord, auditActions } = createHarness();
    const sourceRecord = await captureRecord({ retainedContent: "Lunch with Mark." });

    const { job, created } = await processor.enqueueExtractionJob({
      sourceRecordId: sourceRecord.id,
    });

    expect(created).toBe(true);
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(0);
    expect(job.sourceRecordId).toBe(sourceRecord.id);
    await expect(auditActions()).resolves.toContain("extraction_job.enqueue");
  });

  it("is idempotent: re-enqueuing a source record returns the existing job", async () => {
    const { processor, captureRecord } = createHarness();
    const sourceRecord = await captureRecord({ retainedContent: "Lunch with Mark." });

    const first = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });
    const second = await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
  });

  it("rejects enqueue for an unknown source record", async () => {
    const { processor } = createHarness();

    await expect(processor.enqueueExtractionJob({ sourceRecordId: "missing" })).rejects.toThrow();
  });
});
