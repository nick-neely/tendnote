import { createInMemoryBackgroundJobDeliveryStore } from "@tendnote/db/queries/background-job-deliveries";
import type { EnqueueAndTriggerSemanticEmbeddingJobResult } from "@tendnote/db/queries/semantic-retrieval";
import { describe, expect, it, vi } from "vitest";
import vercelConfig from "../../../vercel.json";
import {
  consumeEmbeddingQueueMessage,
  enqueueAndPublishSemanticEmbeddingJob,
} from "./embedding-queue";
import { BACKGROUND_JOB_QUEUE_CONFIG } from "./queue-runtime";

const embeddingJob = {
  id: "00000000-0000-0000-0000-000000000601",
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

describe("embedding queue delivery", () => {
  it("creates an embedding delivery intent and publishes the queue pointer", async () => {
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
        topic: BACKGROUND_JOB_QUEUE_CONFIG.embedding.topic,
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

  it("records queue publish failure without throwing from scheduling", async () => {
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

    expect(result.publishResult?.ok).toBe(false);
    await expect(
      deliveryStore.getBackgroundJobDeliveryForConsumer(result.deliveryId ?? ""),
    ).resolves.toMatchObject({
      status: "publish_failed",
      attempts: 1,
      lastError: "queue down",
    });
  });

  it("claims and processes only the delivered embedding job id", async () => {
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
    const claimJob = vi.fn().mockResolvedValue({ ...embeddingJob, status: "running" });
    const processJob = vi.fn().mockResolvedValue({
      job: { ...embeddingJob, status: "completed" },
      outcome: "completed",
      embedding: {},
    });

    await consumeEmbeddingQueueMessage({
      deliveryStore,
      payload: {
        deliveryId: result.deliveryId,
        jobKind: "embedding",
        jobId: embeddingJob.id,
      },
      claimJob,
      processJob,
    });

    expect(claimJob).toHaveBeenCalledWith({ jobId: embeddingJob.id, now: undefined });
    expect(processJob).toHaveBeenCalledWith({ jobId: embeddingJob.id, claim: false });
  });

  it("no-ops safely when a duplicate embedding message cannot claim the job", async () => {
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
    const claimJob = vi.fn().mockResolvedValue(null);
    const getJob = vi.fn().mockResolvedValue({ ...embeddingJob, status: "completed" });
    const processJob = vi.fn();

    const consumed = await consumeEmbeddingQueueMessage({
      deliveryStore,
      payload: {
        deliveryId: result.deliveryId,
        jobKind: "embedding",
        jobId: embeddingJob.id,
      },
      claimJob,
      getJob,
      processJob,
    });

    expect(consumed).toMatchObject({ status: "ignored", reason: "terminal" });
    expect(processJob).not.toHaveBeenCalled();
  });

  it("no-ops safely when an embedding delivery is stale", async () => {
    const deliveryStore = createInMemoryBackgroundJobDeliveryStore();
    const { delivery } = await deliveryStore.createBackgroundJobDelivery({
      ownerUserId: "user-1",
      jobKind: "embedding",
      jobId: embeddingJob.id,
    });
    await deliveryStore.markBackgroundJobDeliveryPublishFailed({
      ownerUserId: "user-1",
      deliveryId: delivery.id,
      error: "queue down",
      nextAttemptAt: new Date("2026-06-29T12:05:00.000Z"),
    });
    const processJob = vi.fn();

    const consumed = await consumeEmbeddingQueueMessage({
      deliveryStore,
      payload: {
        deliveryId: delivery.id,
        jobKind: "embedding",
        jobId: embeddingJob.id,
      },
      processJob,
    });

    expect(consumed).toMatchObject({ status: "ignored", reason: "stale_delivery" });
    expect(processJob).not.toHaveBeenCalled();
  });

  it("lets provider throttling remain retryable Postgres job state", async () => {
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
    const retryAt = new Date("2026-06-29T12:05:00.000Z");
    const claimJob = vi.fn().mockResolvedValue({ ...embeddingJob, status: "running" });
    const processJob = vi.fn().mockResolvedValue({
      job: {
        ...embeddingJob,
        status: "failed",
        lastError: "provider throttled",
        runAfter: retryAt,
        claimedAt: null,
      },
      outcome: "failed",
      error: "provider throttled",
      embedding: null,
    });

    await expect(
      consumeEmbeddingQueueMessage({
        deliveryStore,
        payload: {
          deliveryId: result.deliveryId,
          jobKind: "embedding",
          jobId: embeddingJob.id,
        },
        claimJob,
        processJob,
      }),
    ).rejects.toThrow("provider throttled");

    const processorResult = await processJob.mock.results[0]?.value;
    expect(processorResult).toMatchObject({
      outcome: "failed",
      job: {
        status: "failed",
        lastError: "provider throttled",
        runAfter: retryAt,
        claimedAt: null,
      },
    });
  });

  it("configures a Vercel queue trigger for the embedding callback route", () => {
    expect(vercelConfig.functions["src/app/api/queue/embedding/route.ts"]).toEqual({
      experimentalTriggers: [
        {
          type: "queue/v2beta",
          topic: BACKGROUND_JOB_QUEUE_CONFIG.embedding.topic,
        },
      ],
    });
  });
});
