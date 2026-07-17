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
import {
  consumeExtractionQueueMessage,
  enqueueAndPublishActionExtractionJob,
  enqueueAndPublishExtractionJob,
} from "./extraction-queue";
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
    ).rejects.toThrow("provider throttled");

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
        },
      ],
    });
  });
});

const actionJob = {
  id: "00000000-0000-0000-0000-000000000301",
  sourceRecordId: "source-1",
  status: "pending",
  attempts: 0,
  lastError: null,
  idempotencyKey: "action:source_record:source-1",
  runAfter: new Date("2026-06-29T12:00:00.000Z"),
  claimedAt: null,
  completedAt: null,
  createdAt: new Date("2026-06-29T12:00:00.000Z"),
  updatedAt: new Date("2026-06-29T12:00:00.000Z"),
} as const;

describe("action extraction queue delivery", () => {
  it("publishes an action_extraction delivery on the shared extraction topic in enqueue-only mode", async () => {
    const deliveryStore = createInMemoryBackgroundJobDeliveryStore();
    const queue = { send: vi.fn().mockResolvedValue({ messageId: "msg-a1" }) };

    const result = await enqueueAndPublishActionExtractionJob({
      ownerUserId: "user-1",
      sourceRecordId: "source-1",
      runtimeMode: "enqueue_only",
      deliveryStore,
      queue,
      enqueueActionExtraction: vi
        .fn()
        .mockResolvedValue({ job: actionJob, created: true, processResult: null }),
    });

    expect(result.deliveryId).toEqual(expect.any(String));
    // Rides the extraction topic but stays a distinct action_extraction delivery.
    expect(queue.send).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: BACKGROUND_JOB_QUEUE_CONFIG.action_extraction.topic,
        payload: {
          deliveryId: result.deliveryId,
          jobKind: "action_extraction",
          jobId: actionJob.id,
        },
      }),
    );
    await expect(
      deliveryStore.getBackgroundJobDeliveryForConsumer(result.deliveryId ?? ""),
    ).resolves.toMatchObject({
      jobKind: "action_extraction",
      jobId: actionJob.id,
      status: "published",
    });
  });

  it("dispatches an action_extraction message to the action processor", async () => {
    const deliveryStore = createInMemoryBackgroundJobDeliveryStore();
    const queue = { send: vi.fn().mockResolvedValue({ messageId: "msg-a2" }) };
    const result = await enqueueAndPublishActionExtractionJob({
      ownerUserId: "user-1",
      sourceRecordId: "source-1",
      runtimeMode: "enqueue_only",
      deliveryStore,
      queue,
      enqueueActionExtraction: vi
        .fn()
        .mockResolvedValue({ job: actionJob, created: true, processResult: null }),
    });

    const claimActionJob = vi.fn().mockResolvedValue({ ...actionJob, status: "running" });
    const processActionJob = vi
      .fn()
      .mockResolvedValue({ outcome: "completed", suggestedActionIds: [] });
    // Memory processors must not be touched for an action_extraction message.
    const processJob = vi.fn();

    const consumed = await consumeExtractionQueueMessage({
      deliveryStore,
      payload: {
        deliveryId: result.deliveryId,
        jobKind: "action_extraction",
        jobId: actionJob.id,
      },
      claimActionJob,
      processActionJob,
      processJob,
    });

    expect(consumed).toMatchObject({ status: "processed" });
    expect(processActionJob).toHaveBeenCalledWith({ jobId: actionJob.id, claim: false });
    expect(processJob).not.toHaveBeenCalled();
  });
});
