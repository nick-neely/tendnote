import { createInMemoryBackgroundJobDeliveryStore } from "@tendnote/db/queries/background-job-deliveries";
import type { EnqueueAndTriggerExtractionJobResult } from "@tendnote/db/queries/extraction-jobs";
import { describe, expect, it, vi } from "vitest";
import { enqueueAndPublishExtractionJob } from "../lib/background-jobs/extraction-queue";

const extractionJob = {
  id: "00000000-0000-0000-0000-000000000401",
  sourceRecordId: "source-1",
  status: "pending",
  attempts: 0,
  lastError: null,
  idempotencyKey: "source-record:source-1",
  runAfter: new Date("2026-06-29T12:00:00.000Z"),
  claimedAt: null,
  completedAt: null,
  createdAt: new Date("2026-06-29T12:00:00.000Z"),
  updatedAt: new Date("2026-06-29T12:00:00.000Z"),
} as const;

function enqueueResult(): EnqueueAndTriggerExtractionJobResult {
  return {
    job: extractionJob,
    created: true,
    processResult: null,
  };
}

describe("agent extraction queue delivery", () => {
  it("creates and publishes an extraction delivery intent", async () => {
    const deliveryStore = createInMemoryBackgroundJobDeliveryStore();
    const queue = { send: vi.fn().mockResolvedValue({ messageId: "msg-1" }) };

    const result = await enqueueAndPublishExtractionJob({
      ownerUserId: "user-1",
      sourceRecordId: "source-1",
      runtimeMode: "enqueue_only",
      deliveryStore,
      queue,
      enqueueExtraction: vi.fn().mockResolvedValue(enqueueResult()),
    });

    expect(queue.send).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "tendnote-extraction-v1",
        payload: {
          deliveryId: result.deliveryId,
          jobKind: "extraction",
          jobId: extractionJob.id,
        },
      }),
    );
    await expect(
      deliveryStore.getBackgroundJobDeliveryForConsumer(result.deliveryId ?? ""),
    ).resolves.toMatchObject({
      ownerUserId: "user-1",
      jobKind: "extraction",
      jobId: extractionJob.id,
      status: "published",
    });
  });

  it("records publish failure without throwing", async () => {
    const deliveryStore = createInMemoryBackgroundJobDeliveryStore();
    const queue = { send: vi.fn().mockRejectedValue(new Error("queue down")) };

    const result = await enqueueAndPublishExtractionJob({
      ownerUserId: "user-1",
      sourceRecordId: "source-1",
      runtimeMode: "enqueue_only",
      deliveryStore,
      queue,
      enqueueExtraction: vi.fn().mockResolvedValue(enqueueResult()),
    });

    await expect(
      deliveryStore.getBackgroundJobDeliveryForConsumer(result.deliveryId ?? ""),
    ).resolves.toMatchObject({
      status: "publish_failed",
      attempts: 1,
      lastError: "queue down",
    });
  });
});
