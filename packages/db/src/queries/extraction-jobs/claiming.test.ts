import { describe, expect, it } from "vitest";
import { createHarness } from "./harness";

describe("extraction job claiming and lifecycle", () => {
  it("claims the next due job, moving it from queued to running", async () => {
    const { processor, captureRecord } = createHarness();
    const sourceRecord = await captureRecord({ retainedContent: "Note." });
    await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id });

    const claimed = await processor.claimNextExtractionJob();

    expect(claimed?.status).toBe("running");
    expect(claimed?.attempts).toBe(1);
  });

  it("does not claim a job scheduled to run in the future", async () => {
    const { processor, captureRecord } = createHarness();
    const sourceRecord = await captureRecord({ retainedContent: "Note." });
    const future = new Date(Date.now() + 60_000);
    await processor.enqueueExtractionJob({ sourceRecordId: sourceRecord.id, runAfter: future });

    await expect(processor.claimNextExtractionJob()).resolves.toBeNull();
  });
  it("reclaims an expired run but leaves a live claim alone", async () => {
    const { processor, captureRecord } = createHarness();
    const record = await captureRecord({ retainedContent: "Note." });
    const start = new Date("2026-07-04T02:00:00Z");
    const { job } = await processor.enqueueExtractionJob({
      sourceRecordId: record.id,
      runAfter: start,
    });
    await processor.claimNextExtractionJob({ now: start });
    await expect(
      processor.claimNextExtractionJob({ now: new Date("2026-07-04T02:14:59Z") }),
    ).resolves.toBeNull();
    const recovered = await processor.claimNextExtractionJob({
      now: new Date("2026-07-04T02:15:00Z"),
    });
    expect(recovered).toMatchObject({
      id: job.id,
      status: "running",
      attempts: 2,
      claimedAt: new Date("2026-07-04T02:15:00Z"),
    });
    await expect(
      processor.claimNextExtractionJob({ now: new Date("2026-07-04T02:15:00Z") }),
    ).resolves.toBeNull();
  });

  it("reclaims a delivered expired job by id and can finish it", async () => {
    const { processor, captureRecord } = createHarness();
    const record = await captureRecord({ retainedContent: "Note." });
    const start = new Date("2026-07-04T02:00:00Z");
    const { job } = await processor.enqueueExtractionJob({
      sourceRecordId: record.id,
      runAfter: start,
    });
    await processor.claimExtractionJob({ jobId: job.id, now: start });
    await expect(processor.claimExtractionJob({ jobId: job.id, now: start })).resolves.toBeNull();
    const now = new Date("2026-07-04T02:15:00Z");
    await expect(processor.claimExtractionJob({ jobId: job.id, now })).resolves.toMatchObject({
      attempts: 2,
    });
    const result = await processor.processExtractionJob({ jobId: job.id, claim: false, now });
    expect(result.outcome).toBe("skipped");
    await expect(
      processor.claimExtractionJob({ jobId: job.id, now: new Date("2026-07-04T03:00:00Z") }),
    ).resolves.toBeNull();
  });

  it("bounds legacy running rows without a claim timestamp by their last update", async () => {
    const { processor, store, captureRecord } = createHarness();
    const record = await captureRecord({ retainedContent: "Note." });
    const { job } = await processor.enqueueExtractionJob({
      sourceRecordId: record.id,
      runAfter: new Date(0),
    });
    const legacy = await store.updateExtractionJob({
      jobId: job.id,
      status: "running",
      claimedAt: null,
    });
    await expect(processor.claimNextExtractionJob({ now: legacy.updatedAt })).resolves.toBeNull();
    await expect(
      processor.claimNextExtractionJob({ now: new Date(legacy.updatedAt.getTime() + 900_000) }),
    ).resolves.toMatchObject({ id: job.id, attempts: 1 });
  });
});
