import { createInMemoryBackgroundJobDeliveryStore } from "@tendnote/db/queries/background-job-deliveries";
import { describe, expect, it, vi } from "vitest";
import vercelConfig from "../../../vercel.json";
import { maxDuration as recoveryMaxDuration } from "../../app/api/cron/background-jobs/route";
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
      errorCode: "configuration_missing",
    });
  });

  it("runs embedding backfill through the shared processor seam with a cap", async () => {
    const claimNextJob = vi
      .fn()
      .mockResolvedValueOnce({ id: "job-1" })
      .mockResolvedValueOnce({ id: "job-2" });
    const processJob = vi.fn().mockResolvedValue({ outcome: "completed" });
    const recoverStaleJobs = vi.fn().mockResolvedValue({ jobs: [{ id: "stale-job-1" }] });
    const logger = { info: vi.fn(), error: vi.fn() };

    const result = await runEmbeddingBackfill({
      limit: 1,
      claimNextJob,
      processJob,
      recoverStaleJobs,
      now: new Date("2026-06-29T12:00:00.000Z"),
      logger,
    });

    expect(result).toEqual({ recovered: 1, scanned: 1, processed: 1, failed: 0 });
    expect(recoverStaleJobs).toHaveBeenCalledWith({
      limit: 1,
      now: new Date("2026-06-29T12:00:00.000Z"),
      leaseDurationMs: 600_000,
    });
    expect(claimNextJob).toHaveBeenCalledTimes(1);
    expect(processJob).toHaveBeenCalledWith({ jobId: "job-1", claim: false });
    expect(logger.info).toHaveBeenCalledWith("background_job_recovery.embedding_job_recovered", {
      jobId: "stale-job-1",
    });
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
      backfillEmbedding: vi
        .fn()
        .mockResolvedValue({ recovered: 1, scanned: 1, processed: 0, failed: 1 }),
      backfillActionExtraction: vi.fn().mockResolvedValue({ scanned: 1, processed: 1, failed: 0 }),
      purgeDissolvedHouseholds: vi
        .fn()
        .mockResolvedValue({ scanned: 1, purged: 1, skipped: 0, failed: 0 }),
    });

    expect(result).toEqual({
      deliveries: { scanned: 1, republished: 1, failed: 0, abandoned: 0 },
      extraction: { scanned: 1, processed: 1, failed: 0 },
      embedding: { recovered: 1, scanned: 1, processed: 0, failed: 1 },
      actionExtraction: { scanned: 1, processed: 1, failed: 0 },
      contextFactExtraction: { scanned: 0, processed: 0, failed: 0 },
      ownerDataExport: { scanned: 0, processed: 0, failed: 0 },
      householdPurge: { scanned: 1, purged: 1, skipped: 0, failed: 0 },
      auditRetention: { scanned: 0, deleted: 0, skipped: 0, failed: 0 },
    });
  });

  it("closes the household recovery window on the same bounded cron pass", async () => {
    // The sweep rides the existing ten-minute cron rather than a schedule of its
    // own: a thirty-day deadline does not need its own timer, and a second cron
    // entry would be a second place for the deletion promise to be switched off.
    const order: string[] = [];
    const purge = vi.fn().mockImplementation(async () => {
      order.push("household-purge");
      return { scanned: 3, purged: 2, skipped: 1, failed: 0 };
    });
    const retainAuditLog = vi.fn().mockImplementation(async () => {
      order.push("audit-retention");
      return { scanned: 2, deleted: 1, skipped: 1, failed: 0 };
    });

    const result = await runBackgroundJobRecovery({
      deliveryLimit: 0,
      extractionBackfillLimit: 0,
      embeddingBackfillLimit: 0,
      actionExtractionBackfillLimit: 0,
      householdPurgeLimit: 5,
      auditRetentionLimit: 7,
      recoverDeliveries: vi
        .fn()
        .mockResolvedValue({ scanned: 0, republished: 0, failed: 0, abandoned: 0 }),
      backfillExtraction: vi.fn().mockResolvedValue({ scanned: 0, processed: 0, failed: 0 }),
      backfillEmbedding: vi
        .fn()
        .mockResolvedValue({ recovered: 0, scanned: 0, processed: 0, failed: 0 }),
      backfillActionExtraction: vi.fn().mockResolvedValue({ scanned: 0, processed: 0, failed: 0 }),
      purgeDissolvedHouseholds: purge,
      retainAuditLog,
    });

    expect(purge).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }));
    expect(retainAuditLog).toHaveBeenCalledWith(expect.objectContaining({ limit: 7 }));
    expect(order).toEqual(["household-purge", "audit-retention"]);
    expect(result.auditRetention).toEqual({ scanned: 2, deleted: 1, skipped: 1, failed: 0 });
    expect(result.householdPurge).toEqual({ scanned: 3, purged: 2, skipped: 1, failed: 0 });
  });

  it("still attempts audit retention when an earlier recovery stage fails", async () => {
    const recoveryError = new Error("delivery recovery failed");
    const retainAuditLog = vi
      .fn()
      .mockResolvedValue({ scanned: 1, deleted: 1, skipped: 0, failed: 0 });

    await expect(
      runBackgroundJobRecovery({
        deliveryLimit: 1,
        extractionBackfillLimit: 1,
        embeddingBackfillLimit: 1,
        actionExtractionBackfillLimit: 1,
        auditRetentionLimit: 7,
        recoverDeliveries: vi.fn().mockRejectedValue(recoveryError),
        retainAuditLog,
      }),
    ).rejects.toBe(recoveryError);

    expect(retainAuditLog).toHaveBeenCalledWith(expect.objectContaining({ limit: 7 }));
  });

  it("preserves an earlier failure when audit retention also fails", async () => {
    const recoveryError = new Error("delivery recovery failed");
    const retentionError = new Error("postgres detail: private connection string");
    const logger = { error: vi.fn() };

    await expect(
      runBackgroundJobRecovery({
        deliveryLimit: 1,
        extractionBackfillLimit: 1,
        embeddingBackfillLimit: 1,
        actionExtractionBackfillLimit: 1,
        auditRetentionLimit: 7,
        logger,
        recoverDeliveries: vi.fn().mockRejectedValue(recoveryError),
        retainAuditLog: vi.fn().mockRejectedValue(retentionError),
      }),
    ).rejects.toBe(recoveryError);

    expect(logger.error).toHaveBeenCalledWith("background_job_recovery.audit_retention_failed", {
      stage: "audit_retention",
      reason: "retention_failed_after_recovery_stage",
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private connection string");
  });

  it("propagates an audit retention failure when recovery completes", async () => {
    const retentionError = new Error("audit retention unavailable");

    await expect(
      runBackgroundJobRecovery({
        deliveryLimit: 0,
        extractionBackfillLimit: 0,
        embeddingBackfillLimit: 0,
        actionExtractionBackfillLimit: 0,
        recoverDeliveries: vi
          .fn()
          .mockResolvedValue({ scanned: 0, republished: 0, failed: 0, abandoned: 0 }),
        backfillExtraction: vi.fn().mockResolvedValue({ scanned: 0, processed: 0, failed: 0 }),
        backfillEmbedding: vi
          .fn()
          .mockResolvedValue({ recovered: 0, scanned: 0, processed: 0, failed: 0 }),
        backfillActionExtraction: vi
          .fn()
          .mockResolvedValue({ scanned: 0, processed: 0, failed: 0 }),
        retainAuditLog: vi.fn().mockRejectedValue(retentionError),
      }),
    ).rejects.toBe(retentionError);
  });

  it("purges nothing when the run is given no household budget", async () => {
    const purge = vi.fn().mockResolvedValue({ scanned: 0, purged: 0, skipped: 0, failed: 0 });

    const result = await runBackgroundJobRecovery({
      deliveryLimit: 0,
      extractionBackfillLimit: 0,
      embeddingBackfillLimit: 0,
      actionExtractionBackfillLimit: 0,
      recoverDeliveries: vi
        .fn()
        .mockResolvedValue({ scanned: 0, republished: 0, failed: 0, abandoned: 0 }),
      backfillExtraction: vi.fn().mockResolvedValue({ scanned: 0, processed: 0, failed: 0 }),
      backfillEmbedding: vi
        .fn()
        .mockResolvedValue({ recovered: 0, scanned: 0, processed: 0, failed: 0 }),
      backfillActionExtraction: vi.fn().mockResolvedValue({ scanned: 0, processed: 0, failed: 0 }),
      purgeDissolvedHouseholds: purge,
    });

    expect(purge).toHaveBeenCalledWith(expect.objectContaining({ limit: 0 }));
    expect(result.householdPurge).toEqual({ scanned: 0, purged: 0, skipped: 0, failed: 0 });
    expect(result.auditRetention).toEqual({ scanned: 0, deleted: 0, skipped: 0, failed: 0 });
  });

  it("configures a bounded Vercel cron trigger for recovery", () => {
    expect(recoveryMaxDuration).toBe(300);
    expect(vercelConfig.crons).toContainEqual({
      path: "/api/cron/background-jobs",
      schedule: "*/10 * * * *",
    });
  });
});
