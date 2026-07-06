import { describe, expect, it } from "vitest";
import { createHarness } from "./harness";

describe("action extraction job claiming and lifecycle", () => {
  it("claims the next due job, moving it from queued to running", async () => {
    const { processor, captureRecord } = createHarness();
    const source = await captureRecord({ content: "Note." });
    await processor.enqueueActionExtractionJob({ sourceRecordId: source.id });

    const claimed = await processor.claimNextActionExtractionJob();

    expect(claimed?.status).toBe("running");
    expect(claimed?.attempts).toBe(1);
  });

  it("does not claim a job scheduled to run in the future", async () => {
    const { processor, captureRecord } = createHarness();
    const source = await captureRecord({ content: "Note." });
    const future = new Date(Date.now() + 60_000);
    await processor.enqueueActionExtractionJob({ sourceRecordId: source.id, runAfter: future });

    await expect(processor.claimNextActionExtractionJob()).resolves.toBeNull();
  });

  it("claims a specific job by id and refuses a job already claimed", async () => {
    const { processor, captureRecord } = createHarness();
    const source = await captureRecord({ content: "Note." });
    const { job } = await processor.enqueueActionExtractionJob({ sourceRecordId: source.id });

    const claimed = await processor.claimActionExtractionJob({ jobId: job.id });
    expect(claimed?.status).toBe("running");

    // A second claim of the now-running job returns null (not re-claimable).
    await expect(processor.claimActionExtractionJob({ jobId: job.id })).resolves.toBeNull();
  });
});
