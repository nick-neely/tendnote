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
});
