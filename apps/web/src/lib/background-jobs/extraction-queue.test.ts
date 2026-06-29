import { createInMemoryBackgroundJobDeliveryStore } from "@tendnote/db/queries/background-job-deliveries";
import {
  createExtractionProcessor,
  createInMemoryExtractionJobStore,
  type EnqueueAndTriggerExtractionJobResult,
} from "@tendnote/db/queries/extraction-jobs";
import {
  createSourceRecordCapture,
  createSourceRecordResolution,
} from "@tendnote/db/queries/source-records";
import { describe, expect, it, vi } from "vitest";
import vercelConfig from "../../../vercel.json";
import { consumeExtractionQueueMessage, enqueueAndPublishExtractionJob } from "./extraction-queue";
import { BACKGROUND_JOB_QUEUE_CONFIG } from "./queue-runtime";

const extractionJob = {
  id: "00000000-0000-0000-0000-000000000201",
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

describe("extraction queue delivery", () => {
  it("keeps local inline extraction available without creating a delivery intent", async () => {
    const deliveryStore = createInMemoryBackgroundJobDeliveryStore();
    const enqueueExtraction = vi.fn().mockResolvedValue({
      ...enqueueResult(),
      processResult: {
        job: extractionJob,
        outcome: "completed",
        suggestedMemories: [],
      },
    });
    const queue = { send: vi.fn() };

    const result = await enqueueAndPublishExtractionJob({
      ownerUserId: "user-1",
      sourceRecordId: "source-1",
      runtimeMode: "inline",
      deliveryStore,
      queue,
      enqueueExtraction,
    });

    expect(result.deliveryId).toBeNull();
    expect(result.publishResult).toBeNull();
    expect(queue.send).not.toHaveBeenCalled();
    expect(enqueueExtraction).toHaveBeenCalledWith({
      sourceRecordId: "source-1",
      runtimeMode: "inline",
    });
    await expect(
      deliveryStore.listBackgroundJobDeliveries({ ownerUserId: "user-1" }),
    ).resolves.toEqual([]);
  });

  it("creates an extraction delivery intent and publishes the queue pointer in enqueue-only mode", async () => {
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

    expect(result.deliveryId).toEqual(expect.any(String));
    expect(queue.send).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: BACKGROUND_JOB_QUEUE_CONFIG.extraction.topic,
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

  it("records queue publish failure without throwing from source-record scheduling", async () => {
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

    expect(result.publishResult?.ok).toBe(false);
    await expect(
      deliveryStore.getBackgroundJobDeliveryForConsumer(result.deliveryId ?? ""),
    ).resolves.toMatchObject({
      status: "publish_failed",
      attempts: 1,
      lastError: "queue down",
    });
  });

  it("claims and processes only the delivered extraction job id", async () => {
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
    const claimJob = vi.fn().mockResolvedValue({ ...extractionJob, status: "running" });
    const processJob = vi.fn().mockResolvedValue({
      job: { ...extractionJob, status: "completed" },
      outcome: "completed",
      suggestedMemories: [],
    });

    await consumeExtractionQueueMessage({
      deliveryStore,
      payload: {
        deliveryId: result.deliveryId,
        jobKind: "extraction",
        jobId: extractionJob.id,
      },
      claimJob,
      processJob,
    });

    expect(claimJob).toHaveBeenCalledWith({ jobId: extractionJob.id, now: undefined });
    expect(processJob).toHaveBeenCalledWith({ jobId: extractionJob.id, claim: false });
  });

  it("no-ops safely when a duplicate extraction message finds a terminal job", async () => {
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
    const claimJob = vi.fn().mockResolvedValue(null);
    const getJob = vi.fn().mockResolvedValue({ ...extractionJob, status: "completed" });
    const processJob = vi.fn();

    const consumed = await consumeExtractionQueueMessage({
      deliveryStore,
      payload: {
        deliveryId: result.deliveryId,
        jobKind: "extraction",
        jobId: extractionJob.id,
      },
      claimJob,
      getJob,
      processJob,
    });

    expect(consumed).toMatchObject({ status: "ignored", reason: "terminal" });
    expect(processJob).not.toHaveBeenCalled();
  });

  it("no-ops safely when an extraction job is not claimable yet", async () => {
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
    const futureJob = {
      ...extractionJob,
      status: "failed",
      runAfter: new Date("2026-06-29T12:10:00.000Z"),
    };
    const claimJob = vi.fn().mockResolvedValue(null);
    const getJob = vi.fn().mockResolvedValue(futureJob);
    const processJob = vi.fn();

    const consumed = await consumeExtractionQueueMessage({
      deliveryStore,
      payload: {
        deliveryId: result.deliveryId,
        jobKind: "extraction",
        jobId: extractionJob.id,
      },
      now: new Date("2026-06-29T12:00:00.000Z"),
      claimJob,
      getJob,
      processJob,
    });

    expect(consumed).toMatchObject({ status: "ignored", reason: "not_claimable" });
    expect(processJob).not.toHaveBeenCalled();
  });

  it("no-ops safely when an extraction delivery is stale", async () => {
    const deliveryStore = createInMemoryBackgroundJobDeliveryStore();
    const { delivery } = await deliveryStore.createBackgroundJobDelivery({
      ownerUserId: "user-1",
      jobKind: "extraction",
      jobId: extractionJob.id,
    });
    await deliveryStore.markBackgroundJobDeliveryPublishFailed({
      ownerUserId: "user-1",
      deliveryId: delivery.id,
      error: "queue down",
      nextAttemptAt: new Date("2026-06-29T12:05:00.000Z"),
    });
    const claimJob = vi.fn();
    const processJob = vi.fn();

    const consumed = await consumeExtractionQueueMessage({
      deliveryStore,
      payload: {
        deliveryId: delivery.id,
        jobKind: "extraction",
        jobId: extractionJob.id,
      },
      claimJob,
      processJob,
    });

    expect(consumed).toMatchObject({ status: "ignored", reason: "stale_delivery" });
    expect(claimJob).not.toHaveBeenCalled();
    expect(processJob).not.toHaveBeenCalled();
    await expect(deliveryStore.getBackgroundJobDeliveryForConsumer(delivery.id)).resolves.toEqual(
      expect.objectContaining({
        status: "publish_failed",
        lastError: "Queue payload referenced publish_failed delivery.",
      }),
    );
  });

  it("keeps provider failures as retryable extraction job state without queue-owned retry", async () => {
    const now = new Date("2026-06-29T12:00:00.000Z");
    const store = createInMemoryExtractionJobStore();
    const processor = createExtractionProcessor(store, {
      extractionAdapter: {
        kind: "llm",
        model: "test-model",
        promptVersion: "test-prompt",
        async extractCandidates() {
          throw new Error("provider throttled");
        },
      },
    });
    const capture = createSourceRecordCapture(store);
    const resolution = createSourceRecordResolution(store);
    const person = await store.createPerson({
      ownerUserId: "user-1",
      displayName: "Mark",
      firstName: null,
      lastName: null,
      birthday: null,
      relationshipType: "friend",
      closenessLevel: 3,
      profileBlurb: null,
      source: "manual",
    });
    const { sourceRecord } = await capture.captureSourceRecord({
      ownerUserId: "user-1",
      retainedContent: "Mark likes Thai food.",
    });
    await resolution.linkSourceRecordToExistingPerson({
      ownerUserId: "user-1",
      sourceRecordId: sourceRecord.id,
      personId: person.id,
    });
    const { job } = await processor.enqueueExtractionJob({
      sourceRecordId: sourceRecord.id,
      runAfter: now,
    });
    const deliveryStore = createInMemoryBackgroundJobDeliveryStore();
    const { delivery } = await deliveryStore.createBackgroundJobDelivery({
      ownerUserId: "user-1",
      jobKind: "extraction",
      jobId: job.id,
    });
    await deliveryStore.markBackgroundJobDeliveryPublished({
      ownerUserId: "user-1",
      deliveryId: delivery.id,
      publishedAt: now,
    });

    await expect(
      consumeExtractionQueueMessage({
        deliveryStore,
        payload: {
          deliveryId: delivery.id,
          jobKind: "extraction",
          jobId: job.id,
        },
        now,
        claimJob: processor.claimExtractionJob,
        getJob: processor.getExtractionJob,
        processJob: processor.processExtractionJob,
      }),
    ).resolves.toMatchObject({ status: "processed" });

    await expect(processor.getExtractionJob(job.id)).resolves.toMatchObject({
      status: "failed",
      lastError: "provider throttled",
      claimedAt: null,
    });
    const retryable = await processor.getExtractionJob(job.id);
    expect(retryable?.runAfter.getTime()).toBeGreaterThan(now.getTime());
  });

  it("configures a Vercel queue trigger for the extraction callback route", () => {
    expect(vercelConfig.functions["src/app/api/queue/extraction/route.ts"]).toEqual({
      experimentalTriggers: [
        {
          type: "queue/v2beta",
          topic: BACKGROUND_JOB_QUEUE_CONFIG.extraction.topic,
          consumerGroup: BACKGROUND_JOB_QUEUE_CONFIG.extraction.consumerGroup,
        },
      ],
    });
  });
});
