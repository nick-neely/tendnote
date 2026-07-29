import { createInMemoryBackgroundJobDeliveryStore } from "@tendnote/db/queries/background-job-deliveries";
import type { EnqueueAndTriggerSemanticEmbeddingJobResult } from "@tendnote/db/queries/semantic-retrieval";
import { describe, expect, it, vi } from "vitest";
import { enqueueAndPublishSemanticEmbeddingJob } from "../agent/lib/background-jobs/embedding-queue";

const embeddingJob = {
  id: "00000000-0000-0000-0000-000000000501",
  ownerUserId: "user-1",
  recordKind: "memory",
  recordId: "memory-1",
  status: "pending",
  attempts: 0,
  lastError: null,
  idempotencyKey: "embedding:user-1:memory:memory-1",
  runAfter: new Date("2026-06-29T12:00:00.000Z"),
  claimedAt: null,
  completedAt: null,
  rerunRequestedAt: null,
  createdAt: new Date("2026-06-29T12:00:00.000Z"),
  updatedAt: new Date("2026-06-29T12:00:00.000Z"),
} as const;

function enqueueResult(): EnqueueAndTriggerSemanticEmbeddingJobResult {
  return {
    job: embeddingJob,
    created: true,
    processResult: null,
  };
}

describe("agent embedding queue delivery", () => {
  it("creates and publishes an embedding delivery intent", async () => {
    const deliveryStore = createInMemoryBackgroundJobDeliveryStore();
    const queue = { send: vi.fn().mockResolvedValue({ messageId: "msg-1" }) };

    const result = await enqueueAndPublishSemanticEmbeddingJob({
      ownerUserId: "user-1",
      recordKind: "memory",
      recordId: "memory-1",
      runtimeMode: "enqueue_only",
      deliveryStore,
      queue,
      enqueueEmbedding: vi.fn().mockResolvedValue(enqueueResult()),
    });

    expect(queue.send).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "tendnote-embedding-v1",
        payload: {
          deliveryId: result.deliveryId,
          jobKind: "embedding",
          jobId: embeddingJob.id,
        },
      }),
    );
    await expect(
      deliveryStore.getBackgroundJobDeliveryForConsumer(result.deliveryId ?? ""),
    ).resolves.toMatchObject({
      ownerUserId: "user-1",
      jobKind: "embedding",
      jobId: embeddingJob.id,
      status: "published",
    });
  });

  it("records publish failure without throwing", async () => {
    const deliveryStore = createInMemoryBackgroundJobDeliveryStore();
    const queue = { send: vi.fn().mockRejectedValue(new Error("queue down")) };

    const result = await enqueueAndPublishSemanticEmbeddingJob({
      ownerUserId: "user-1",
      recordKind: "memory",
      recordId: "memory-1",
      runtimeMode: "enqueue_only",
      deliveryStore,
      queue,
      enqueueEmbedding: vi.fn().mockResolvedValue(enqueueResult()),
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
