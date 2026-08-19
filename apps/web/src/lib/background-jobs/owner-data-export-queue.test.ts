import { createInMemoryBackgroundJobDeliveryStore } from "@tendnote/db/queries/background-job-deliveries";
import { describe, expect, it, vi } from "vitest";
import vercelConfig from "../../../vercel.json";
import { maxDuration } from "../../app/api/queue/owner-data-export/route";
import {
  consumeOwnerDataExportQueueMessage,
  enqueueAndPublishOwnerDataExportJob,
} from "./owner-data-export-queue";
import { BACKGROUND_JOB_QUEUE_CONFIG } from "./queue-runtime";

const exportJob = {
  id: "00000000-0000-0000-0000-000000000477",
  ownerUserId: "owner-1",
  status: "pending" as const,
  attempts: 0,
  lastError: null,
  idempotencyKey: "owner-export:1",
  runAfter: new Date("2026-08-19T12:00:00.000Z"),
  claimedAt: null,
  completedAt: null,
  artifactExpiresAt: null,
  createdAt: new Date("2026-08-19T12:00:00.000Z"),
  updatedAt: new Date("2026-08-19T12:00:00.000Z"),
};

describe("owner data export queue delivery", () => {
  it("publishes one owner-scoped pointer through the shared delivery ledger", async () => {
    const deliveryStore = createInMemoryBackgroundJobDeliveryStore();
    const queue = { send: vi.fn().mockResolvedValue({ messageId: "export-message" }) };
    const result = await enqueueAndPublishOwnerDataExportJob({
      ownerUserId: "owner-1",
      runtimeMode: "enqueue_only",
      deliveryStore,
      queue,
      enqueueOwnerDataExport: vi.fn().mockResolvedValue({
        job: exportJob,
        created: true,
        processResult: null,
      }),
    });

    expect(queue.send).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "tendnote-owner-data-export-v1",
        payload: {
          deliveryId: result.deliveryId,
          jobKind: "owner_data_export",
          jobId: exportJob.id,
        },
      }),
    );
    await expect(
      deliveryStore.getBackgroundJobDeliveryForConsumer(result.deliveryId ?? ""),
    ).resolves.toMatchObject({
      ownerUserId: "owner-1",
      jobKind: "owner_data_export",
      status: "published",
    });
  });

  it("consumes only the delivered export job and supports retryable processing", async () => {
    const deliveryStore = createInMemoryBackgroundJobDeliveryStore();
    const queue = { send: vi.fn().mockResolvedValue({ messageId: "export-message" }) };
    const scheduled = await enqueueAndPublishOwnerDataExportJob({
      ownerUserId: "owner-1",
      runtimeMode: "enqueue_only",
      deliveryStore,
      queue,
      enqueueOwnerDataExport: vi.fn().mockResolvedValue({
        job: exportJob,
        created: true,
        processResult: null,
      }),
    });
    const claimJob = vi.fn().mockResolvedValue({ status: "running" as const });
    const getJob = vi.fn().mockResolvedValue({ status: "running" as const });
    const processJob = vi.fn().mockResolvedValue({ outcome: "failed", error: "temporary" });

    await expect(
      consumeOwnerDataExportQueueMessage({
        payload: {
          deliveryId: scheduled.deliveryId,
          jobKind: "owner_data_export",
          jobId: exportJob.id,
        },
        deliveryStore,
        claimJob,
        getJob,
        processJob,
      }),
    ).rejects.toThrow("temporary");

    expect(claimJob).toHaveBeenCalledWith({ jobId: exportJob.id, now: undefined });
    expect(processJob).toHaveBeenCalledWith({ jobId: exportJob.id, claim: false });
  });

  it("keeps the queue trigger and callback bounded", () => {
    expect(BACKGROUND_JOB_QUEUE_CONFIG.owner_data_export.topic).toBe(
      "tendnote-owner-data-export-v1",
    );
    expect(vercelConfig.functions["src/app/api/queue/owner-data-export/route.ts"]).toEqual({
      experimentalTriggers: [{ type: "queue/v2beta", topic: "tendnote-owner-data-export-v1" }],
    });
    expect(maxDuration).toBe(300);
  });
});
