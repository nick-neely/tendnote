import { describe, expect, it } from "vitest";
import { createHarness } from "./harness";
import {
  enqueueAndTriggerExtractionJobWithProcessor,
  resolveExtractionRuntimeMode,
} from "./runtime";

describe("extraction runtime mode", () => {
  it("defaults local development to inline processing and production to enqueue-only", () => {
    expect(resolveExtractionRuntimeMode({ nodeEnv: "development" })).toBe("inline");
    expect(resolveExtractionRuntimeMode({ nodeEnv: "test" })).toBe("inline");
    expect(resolveExtractionRuntimeMode({ nodeEnv: "production" })).toBe("enqueue_only");
  });

  it("lets deployment configuration override the default runtime mode", () => {
    expect(resolveExtractionRuntimeMode({ configured: "inline", nodeEnv: "production" })).toBe(
      "inline",
    );
    expect(
      resolveExtractionRuntimeMode({ configured: "enqueue_only", nodeEnv: "development" }),
    ).toBe("enqueue_only");
  });
});

describe("enqueue and trigger extraction", () => {
  it("can process a due job inline after enqueueing", async () => {
    const { processor, store, createPerson, captureRecord, link } = createHarness();
    const mark = await createPerson("Mark");
    const sourceRecord = await captureRecord({ retainedContent: "Mark is training for a 10K." });
    await link(sourceRecord.id, mark.id);

    const result = await enqueueAndTriggerExtractionJobWithProcessor(processor, {
      sourceRecordId: sourceRecord.id,
      runtimeMode: "inline",
    });

    expect(result.created).toBe(true);
    expect(result.processResult?.outcome).toBe("completed");
    await expect(
      store.listMemoriesForSourceRecord({ sourceRecordId: sourceRecord.id }),
    ).resolves.toHaveLength(1);
  });

  it("can leave the job queued for cron or queue workers", async () => {
    const { processor, store, captureRecord } = createHarness();
    const sourceRecord = await captureRecord({ retainedContent: "Unlinked note." });

    const result = await enqueueAndTriggerExtractionJobWithProcessor(processor, {
      sourceRecordId: sourceRecord.id,
      runtimeMode: "enqueue_only",
    });

    expect(result.created).toBe(true);
    expect(result.processResult).toBeNull();
    await expect(store.getExtractionJob(result.job.id)).resolves.toMatchObject({
      status: "pending",
      attempts: 0,
    });
  });
});
