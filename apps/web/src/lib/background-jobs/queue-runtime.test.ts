import { createInMemoryBackgroundJobDeliveryStore } from "@tendnote/db/queries/background-job-deliveries";
import { describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_JOB_QUEUE_CONFIG,
  type BackgroundJobQueuePayload,
  type BackgroundJobQueueSendAdapter,
  backgroundJobQueueIdempotencyKey,
  consumeBackgroundJobQueueMessage,
  publishBackgroundJobDelivery,
} from "./queue-runtime";

function createQueue(
  send: BackgroundJobQueueSendAdapter["send"] = vi.fn().mockResolvedValue({ messageId: "msg-1" }),
) {
  return { send };
}

describe("background job queue runtime", () => {
  it("publishes a delivery pointer and marks the ledger published only after send succeeds", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();
    const queue = createQueue();
    const now = new Date("2026-06-29T12:00:00.000Z");
    const { delivery } = await store.createBackgroundJobDelivery({
      ownerUserId: "user-1",
      jobKind: "extraction",
      jobId: "00000000-0000-0000-0000-000000000101",
    });

    const result = await publishBackgroundJobDelivery({
      store,
      queue,
      ownerUserId: "user-1",
      deliveryId: delivery.id,
      now,
    });

    expect(result.ok).toBe(true);
    expect(queue.send).toHaveBeenCalledWith({
      topic: BACKGROUND_JOB_QUEUE_CONFIG.extraction.topic,
      payload: {
        deliveryId: delivery.id,
        jobKind: "extraction",
        jobId: delivery.jobId,
      },
      idempotencyKey: backgroundJobQueueIdempotencyKey(delivery),
      headers: {
        "x-tendnote-delivery-id": delivery.id,
        "x-tendnote-job-kind": "extraction",
      },
    });
    await expect(
      store.getBackgroundJobDelivery({ ownerUserId: "user-1", deliveryId: delivery.id }),
    ).resolves.toMatchObject({
      status: "published",
      publishedAt: now,
      lastError: null,
    });
  });

  it("records queue send failures as delivery failures without throwing processor state", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();
    const queue = createQueue(vi.fn().mockRejectedValue(new Error("queue unavailable")));
    const now = new Date("2026-06-29T12:00:00.000Z");
    const { delivery } = await store.createBackgroundJobDelivery({
      ownerUserId: "user-1",
      jobKind: "embedding",
      jobId: "00000000-0000-0000-0000-000000000102",
    });

    const result = await publishBackgroundJobDelivery({
      store,
      queue,
      ownerUserId: "user-1",
      deliveryId: delivery.id,
      now,
      retryDelayMs: 60_000,
    });

    expect(result.ok).toBe(false);
    await expect(
      store.getBackgroundJobDelivery({ ownerUserId: "user-1", deliveryId: delivery.id }),
    ).resolves.toMatchObject({
      status: "publish_failed",
      attempts: 1,
      lastError: "queue unavailable",
      nextAttemptAt: new Date("2026-06-29T12:01:00.000Z"),
      publishedAt: null,
    });
  });

  it("validates queue payloads against the delivery row before routing one job", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();
    const queue = createQueue();
    const { delivery } = await store.createBackgroundJobDelivery({
      ownerUserId: "user-1",
      jobKind: "extraction",
      jobId: "00000000-0000-0000-0000-000000000103",
    });
    await publishBackgroundJobDelivery({
      store,
      queue,
      ownerUserId: "user-1",
      deliveryId: delivery.id,
    });
    const claimJob = vi.fn().mockResolvedValue({ status: "ready" as const });
    const processJob = vi.fn().mockResolvedValue(undefined);

    const result = await consumeBackgroundJobQueueMessage({
      store,
      payload: {
        deliveryId: delivery.id,
        jobKind: "extraction",
        jobId: delivery.jobId,
      } satisfies BackgroundJobQueuePayload,
      metadata: { topicName: BACKGROUND_JOB_QUEUE_CONFIG.extraction.topic, messageId: "msg-1" },
      processors: [{ jobKind: "extraction", claimJob, processJob }],
    });

    expect(result.status).toBe("processed");
    expect(claimJob).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      deliveryId: delivery.id,
      jobId: delivery.jobId,
    });
    expect(processJob).toHaveBeenCalledTimes(1);
    expect(processJob).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      deliveryId: delivery.id,
      jobId: delivery.jobId,
      metadata: { topicName: BACKGROUND_JOB_QUEUE_CONFIG.extraction.topic, messageId: "msg-1" },
    });
  });

  it("logs invalid, missing, mismatched, stale, and obsolete messages without processing", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();
    const logger = { warn: vi.fn() };
    const claimJob = vi.fn().mockResolvedValue({ status: "ready" as const });
    const processJob = vi.fn().mockResolvedValue(undefined);
    const processors = [{ jobKind: "embedding" as const, claimJob, processJob }];
    const { delivery } = await store.createBackgroundJobDelivery({
      ownerUserId: "user-1",
      jobKind: "embedding",
      jobId: "00000000-0000-0000-0000-000000000104",
    });

    await consumeBackgroundJobQueueMessage({
      store,
      payload: { deliveryId: delivery.id },
      processors,
      logger,
    });
    await consumeBackgroundJobQueueMessage({
      store,
      payload: {
        deliveryId: "00000000-0000-0000-0000-000000000999",
        jobKind: "embedding",
        jobId: delivery.jobId,
      },
      processors,
      logger,
    });
    await consumeBackgroundJobQueueMessage({
      store,
      payload: { deliveryId: delivery.id, jobKind: "embedding", jobId: "wrong" },
      processors,
      logger,
    });
    await consumeBackgroundJobQueueMessage({
      store,
      payload: { deliveryId: delivery.id, jobKind: "embedding", jobId: delivery.jobId },
      processors,
      logger,
    });
    await store.updateBackgroundJobDelivery({
      ownerUserId: "user-1",
      deliveryId: delivery.id,
      status: "abandoned",
      lastError: "job is terminal",
    });
    await consumeBackgroundJobQueueMessage({
      store,
      payload: { deliveryId: delivery.id, jobKind: "embedding", jobId: delivery.jobId },
      processors,
      logger,
    });

    expect(claimJob).not.toHaveBeenCalled();
    expect(processJob).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "background_job_queue.anomaly",
      expect.objectContaining({ reason: "invalid_payload" }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "background_job_queue.anomaly",
      expect.objectContaining({ reason: "missing_delivery" }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "background_job_queue.anomaly",
      expect.objectContaining({ reason: "payload_mismatch" }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "background_job_queue.anomaly",
      expect.objectContaining({ reason: "stale_delivery" }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "background_job_queue.anomaly",
      expect.objectContaining({ reason: "obsolete_delivery" }),
    );
  });

  it("reloads processor state so duplicate delivery no-ops after the job is terminal", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();
    const queue = createQueue();
    const logger = { warn: vi.fn() };
    const first = await store.createBackgroundJobDelivery({
      ownerUserId: "user-1",
      jobKind: "extraction",
      jobId: "00000000-0000-0000-0000-000000000105",
    });
    const unrelated = await store.createBackgroundJobDelivery({
      ownerUserId: "user-1",
      jobKind: "extraction",
      jobId: "00000000-0000-0000-0000-000000000106",
    });
    await publishBackgroundJobDelivery({
      store,
      queue,
      ownerUserId: "user-1",
      deliveryId: first.delivery.id,
    });
    const payload = {
      deliveryId: first.delivery.id,
      jobKind: "extraction",
      jobId: first.delivery.jobId,
    } satisfies BackgroundJobQueuePayload;
    const claimJob = vi
      .fn()
      .mockResolvedValueOnce({ status: "ready" as const })
      .mockResolvedValueOnce({
        status: "terminal" as const,
        reason: "Extraction job already completed.",
      });
    const processJob = vi.fn().mockResolvedValue(undefined);
    const processors = [{ jobKind: "extraction" as const, claimJob, processJob }];

    await consumeBackgroundJobQueueMessage({ store, payload, processors, logger });
    const duplicate = await consumeBackgroundJobQueueMessage({
      store,
      payload,
      processors,
      metadata: { deliveryCount: 2 },
      logger,
    });

    expect(duplicate).toMatchObject({ status: "ignored", reason: "terminal" });
    expect(claimJob).toHaveBeenCalledTimes(2);
    expect(processJob).toHaveBeenCalledTimes(1);
    expect(processJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: first.delivery.jobId }),
    );
    await expect(
      store.getBackgroundJobDelivery({
        ownerUserId: "user-1",
        deliveryId: unrelated.delivery.id,
      }),
    ).resolves.toMatchObject({ status: "pending" });
    expect(logger.warn).toHaveBeenCalledWith(
      "background_job_queue.anomaly",
      expect.objectContaining({ reason: "duplicate_delivery", deliveryCount: 2 }),
    );
  });

  it("does not process when the processor cannot claim the owner-scoped job", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();
    const queue = createQueue();
    const { delivery } = await store.createBackgroundJobDelivery({
      ownerUserId: "user-1",
      jobKind: "embedding",
      jobId: "00000000-0000-0000-0000-000000000107",
    });
    await publishBackgroundJobDelivery({
      store,
      queue,
      ownerUserId: "user-1",
      deliveryId: delivery.id,
    });
    const claimJob = vi.fn().mockResolvedValue({
      status: "not_found" as const,
      reason: "Embedding job did not belong to the delivery owner.",
    });
    const processJob = vi.fn().mockResolvedValue(undefined);

    const result = await consumeBackgroundJobQueueMessage({
      store,
      payload: {
        deliveryId: delivery.id,
        jobKind: "embedding",
        jobId: delivery.jobId,
      },
      processors: [{ jobKind: "embedding", claimJob, processJob }],
    });

    expect(result).toMatchObject({ status: "ignored", reason: "not_found" });
    expect(claimJob).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      deliveryId: delivery.id,
      jobId: delivery.jobId,
    });
    expect(processJob).not.toHaveBeenCalled();
  });
});
