import { createInMemoryBackgroundJobDeliveryStore } from "@tendnote/db/queries/background-job-deliveries";
import { describe, expect, it, vi } from "vitest";
import vercelConfig from "../../../vercel.json";
import {
  recoverBackgroundJobDeliveries,
  runBackgroundJobRecovery,
  runEmbeddingBackfill,
  runExtractionBackfill,
} from "./recovery";

describe("background job recovery", () => {
  it("republishes due pending and publish-failed deliveries with bounded work", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();
    const now = new Date("2026-06-29T12:00:00.000Z");
    const first = await store.createBackgroundJobDelivery({
      ownerUserId: "user-1",
      jobKind: "extraction",
      jobId: "job-1",
      nextAttemptAt: now,
    });
    const second = await store.createBackgroundJobDelivery({
      ownerUserId: "user-1",
      jobKind: "embedding",
      jobId: "job-2",
      nextAttemptAt: now,
    });
    await store.markBackgroundJobDeliveryPublishFailed({
      ownerUserId: "user-1",
      deliveryId: second.delivery.id,
      error: "queue down",
      nextAttemptAt: now,
    });
    await store.createBackgroundJobDelivery({
      ownerUserId: "user-1",
      jobKind: "embedding",
      jobId: "job-3",
      nextAttemptAt: now,
    });
    const queue = { send: vi.fn().mockResolvedValue({ messageId: "msg-1" }) };

    const result = await recoverBackgroundJobDeliveries({
      store,
      queue,
      now,
      limit: 2,
      inspectJob: vi.fn().mockResolvedValue("active"),
    });

    expect(result).toEqual({ scanned: 2, republished: 2, failed: 0, abandoned: 0 });
    expect(queue.send).toHaveBeenCalledTimes(2);
    await expect(
      store.getBackgroundJobDeliveryForConsumer(first.delivery.id),
    ).resolves.toMatchObject({ status: "published" });
    await expect(
      store.getBackgroundJobDeliveryForConsumer(second.delivery.id),
    ).resolves.toMatchObject({ status: "published" });
  });

  it("records republish failures without processing jobs", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();
    const { delivery } = await store.createBackgroundJobDelivery({
      ownerUserId: "user-1",
      jobKind: "extraction",
      jobId: "job-1",
      nextAttemptAt: new Date("2026-06-29T12:00:00.000Z"),
    });
    const queue = { send: vi.fn().mockRejectedValue(new Error("still down")) };

    const result = await recoverBackgroundJobDeliveries({
      store,
      queue,
      now: new Date("2026-06-29T12:00:00.000Z"),
      limit: 10,
      inspectJob: vi.fn().mockResolvedValue("active"),
    });

    expect(result).toEqual({ scanned: 1, republished: 0, failed: 1, abandoned: 0 });
    await expect(store.getBackgroundJobDeliveryForConsumer(delivery.id)).resolves.toMatchObject({
      status: "publish_failed",
      attempts: 1,
      lastError: "still down",
    });
  });

  it("abandons obsolete delivery intents instead of republishing them", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();
    const { delivery } = await store.createBackgroundJobDelivery({
      ownerUserId: "user-1",
      jobKind: "embedding",
      jobId: "job-1",
      nextAttemptAt: new Date("2026-06-29T12:00:00.000Z"),
    });
    const queue = { send: vi.fn() };
    const logger = { info: vi.fn() };

    const result = await recoverBackgroundJobDeliveries({
      store,
      queue,
      logger,
      now: new Date("2026-06-29T12:00:00.000Z"),
      limit: 10,
      inspectJob: vi.fn().mockResolvedValue("obsolete"),
    });

    expect(result).toEqual({ scanned: 1, republished: 0, failed: 0, abandoned: 1 });
    expect(queue.send).not.toHaveBeenCalled();
    await expect(store.getBackgroundJobDeliveryForConsumer(delivery.id)).resolves.toMatchObject({
      status: "abandoned",
      lastError: "Processor job is terminal or no longer valid.",
    });
    expect(logger.info).toHaveBeenCalledWith(
      "background_job_recovery.delivery_abandoned",
      expect.objectContaining({ deliveryId: delivery.id }),
    );
  });

  it("runs extraction backfill through the shared processor seam with a cap", async () => {
    const claimNextJob = vi
      .fn()
      .mockResolvedValueOnce({ id: "job-1" })
      .mockResolvedValueOnce({ id: "job-2" })
      .mockResolvedValueOnce({ id: "job-3" });
    const processJob = vi
      .fn()
      .mockResolvedValueOnce({ outcome: "completed" })
      .mockResolvedValueOnce({ outcome: "failed", error: "missing extraction model" });
    const logger = { info: vi.fn(), error: vi.fn() };

    const result = await runExtractionBackfill({
      limit: 2,
      claimNextJob,
      processJob,
      now: new Date("2026-06-29T12:00:00.000Z"),
      logger,
    });

    expect(result).toEqual({ scanned: 2, processed: 1, failed: 1 });
    expect(claimNextJob).toHaveBeenCalledTimes(2);
    expect(processJob).toHaveBeenCalledWith({ jobId: "job-1", claim: false });
    expect(processJob).toHaveBeenCalledWith({ jobId: "job-2", claim: false });
    expect(logger.error).toHaveBeenCalledWith("background_job_recovery.processor_failed", {
      jobKind: "extraction",
      jobId: "job-2",
      error: "missing extraction model",
    });
  });

  it("runs embedding backfill through the shared processor seam with a cap", async () => {
    const claimNextJob = vi
      .fn()
      .mockResolvedValueOnce({ id: "job-1" })
      .mockResolvedValueOnce({ id: "job-2" });
    const processJob = vi.fn().mockResolvedValue({ outcome: "completed" });

    const result = await runEmbeddingBackfill({
      limit: 1,
      claimNextJob,
      processJob,
      now: new Date("2026-06-29T12:00:00.000Z"),
    });

    expect(result).toEqual({ scanned: 1, processed: 1, failed: 0 });
    expect(claimNextJob).toHaveBeenCalledTimes(1);
    expect(processJob).toHaveBeenCalledWith({ jobId: "job-1", claim: false });
  });

  it("keeps cron recovery bounded across republish and processor backfill", async () => {
    const result = await runBackgroundJobRecovery({
      deliveryLimit: 1,
      extractionBackfillLimit: 1,
      embeddingBackfillLimit: 1,
      actionExtractionBackfillLimit: 1,
      recoverDeliveries: vi
        .fn()
        .mockResolvedValue({ scanned: 1, republished: 1, failed: 0, abandoned: 0 }),
      backfillExtraction: vi.fn().mockResolvedValue({ scanned: 1, processed: 1, failed: 0 }),
      backfillEmbedding: vi.fn().mockResolvedValue({ scanned: 1, processed: 0, failed: 1 }),
      backfillActionExtraction: vi.fn().mockResolvedValue({ scanned: 1, processed: 1, failed: 0 }),
    });

    expect(result).toEqual({
      deliveries: { scanned: 1, republished: 1, failed: 0, abandoned: 0 },
      extraction: { scanned: 1, processed: 1, failed: 0 },
      embedding: { scanned: 1, processed: 0, failed: 1 },
      actionExtraction: { scanned: 1, processed: 1, failed: 0 },
    });
  });

  it("configures a bounded Vercel cron trigger for recovery", () => {
    expect(vercelConfig.crons).toContainEqual({
      path: "/api/cron/background-jobs",
      schedule: "*/10 * * * *",
    });
  });
});
