import { describe, expect, it, vi } from "vitest";
import { createInMemoryBackgroundJobDeliveryStore } from "../background-job-deliveries/in-memory-store";
import { createBackgroundJobProcessor } from "./consume";
import { enqueueAndPublishBackgroundJob } from "./enqueue-publish";
import type { BackgroundJobFamily, BackgroundJobRuntimeMode } from "./families";

type FakeJob = { job: { id: string }; created: boolean };

/**
 * A minimal family that stands in for any real one, so the shared enqueue/publish and
 * claim-translation mechanics are exercised once rather than per real family. The
 * `families.test.ts` completeness/deletion test proves the real families bind the same
 * shape; here we prove the shared mechanics behave correctly for that shape.
 */
function fakeFamily(overrides: Partial<BackgroundJobFamily<{ recordId: string }, FakeJob>> = {}) {
  return {
    jobKind: "extraction" as const,
    noun: "Fake job",
    resolveRuntimeMode: (mode?: BackgroundJobRuntimeMode) => mode ?? "enqueue_only",
    enqueueAndTrigger: vi.fn(async () => ({ job: { id: "job-1" }, created: true })),
    claimJob: vi.fn(async () => ({ status: "running" as const })),
    getJob: vi.fn(async () => ({ status: "pending" as const })),
    processJob: vi.fn(async () => ({ outcome: "completed" as const })),
    claimNextJob: vi.fn(async () => null),
    ...overrides,
  } satisfies BackgroundJobFamily<{ recordId: string }, FakeJob>;
}

describe("enqueueAndPublishBackgroundJob (shared enqueue → publish)", () => {
  it("keeps inline mode delivery-free", async () => {
    const family = fakeFamily();
    const queue = { send: vi.fn() };
    const deliveryStore = createInMemoryBackgroundJobDeliveryStore();

    const result = await enqueueAndPublishBackgroundJob(family, {
      ownerUserId: "user-1",
      enqueueInput: { recordId: "r-1" },
      runtimeMode: "inline",
      queue,
      deliveryStore,
    });

    expect(result.deliveryId).toBeNull();
    expect(result.publishResult).toBeNull();
    expect(family.enqueueAndTrigger).toHaveBeenCalledWith({
      recordId: "r-1",
      runtimeMode: "inline",
    });
    expect(queue.send).not.toHaveBeenCalled();
    await expect(
      deliveryStore.listBackgroundJobDeliveries({ ownerUserId: "user-1" }),
    ).resolves.toEqual([]);
  });

  it("creates and publishes a delivery intent in enqueue-only mode", async () => {
    const family = fakeFamily();
    const queue = { send: vi.fn().mockResolvedValue({ messageId: "msg-1" }) };
    const deliveryStore = createInMemoryBackgroundJobDeliveryStore();

    const result = await enqueueAndPublishBackgroundJob(family, {
      ownerUserId: "user-1",
      enqueueInput: { recordId: "r-1" },
      runtimeMode: "enqueue_only",
      queue,
      deliveryStore,
    });

    expect(result.deliveryId).toEqual(expect.any(String));
    expect(result.publishResult?.ok).toBe(true);
    await expect(
      deliveryStore.getBackgroundJobDeliveryForConsumer(result.deliveryId ?? ""),
    ).resolves.toMatchObject({
      ownerUserId: "user-1",
      jobKind: "extraction",
      jobId: "job-1",
      status: "published",
    });
  });

  it("leaves a recoverable delivery intent when publication fails after the durable enqueue", async () => {
    const family = fakeFamily();
    const queue = { send: vi.fn().mockRejectedValue(new Error("queue down")) };
    const deliveryStore = createInMemoryBackgroundJobDeliveryStore();

    const result = await enqueueAndPublishBackgroundJob(family, {
      ownerUserId: "user-1",
      enqueueInput: { recordId: "r-1" },
      runtimeMode: "enqueue_only",
      queue,
      deliveryStore,
    });

    // The durable enqueue still happened; only publication failed, and it left an
    // inspectable, retryable delivery row rather than throwing.
    expect(family.enqueueAndTrigger).toHaveBeenCalledTimes(1);
    expect(result.publishResult?.ok).toBe(false);
    await expect(
      deliveryStore.getBackgroundJobDeliveryForConsumer(result.deliveryId ?? ""),
    ).resolves.toMatchObject({ status: "publish_failed", attempts: 1, lastError: "queue down" });
  });

  it("prefers an injected enqueue override over the family default", async () => {
    const family = fakeFamily();
    const enqueue = vi.fn(async () => ({ job: { id: "job-override" }, created: true }));
    const queue = { send: vi.fn().mockResolvedValue({ messageId: "msg-1" }) };
    const deliveryStore = createInMemoryBackgroundJobDeliveryStore();

    await enqueueAndPublishBackgroundJob(family, {
      ownerUserId: "user-1",
      enqueueInput: { recordId: "r-1" },
      runtimeMode: "enqueue_only",
      queue,
      deliveryStore,
      enqueue,
    });

    expect(enqueue).toHaveBeenCalledWith({ recordId: "r-1", runtimeMode: "enqueue_only" });
    expect(family.enqueueAndTrigger).not.toHaveBeenCalled();
  });
});

describe("createBackgroundJobProcessor (shared claim translation)", () => {
  const family = {
    jobKind: "extraction" as const,
    noun: "Fake job",
    claimJob: vi.fn(),
    getJob: vi.fn(),
    processJob: vi.fn(),
  };

  it("is ready when the job claims", async () => {
    const processor = createBackgroundJobProcessor(family, {
      claimJob: vi.fn().mockResolvedValue({ status: "running" as const }),
    });
    await expect(
      processor.claimJob({ ownerUserId: "u", deliveryId: "d", jobId: "j" }),
    ).resolves.toEqual({ status: "ready" });
  });

  it("maps a claim miss to not_found / terminal / not_claimable", async () => {
    const notFound = createBackgroundJobProcessor(family, {
      claimJob: vi.fn().mockResolvedValue(null),
      getJob: vi.fn().mockResolvedValue(null),
    });
    await expect(
      notFound.claimJob({ ownerUserId: "u", deliveryId: "d", jobId: "j" }),
    ).resolves.toEqual({ status: "not_found", reason: "Fake job not found." });

    const terminal = createBackgroundJobProcessor(family, {
      claimJob: vi.fn().mockResolvedValue(null),
      getJob: vi.fn().mockResolvedValue({ status: "completed" as const }),
    });
    await expect(
      terminal.claimJob({ ownerUserId: "u", deliveryId: "d", jobId: "j" }),
    ).resolves.toEqual({ status: "terminal", reason: "Fake job is completed." });

    const retryPending = createBackgroundJobProcessor(family, {
      claimJob: vi.fn().mockResolvedValue(null),
      getJob: vi.fn().mockResolvedValue({ status: "failed" as const }),
    });
    await expect(
      retryPending.claimJob({ ownerUserId: "u", deliveryId: "d", jobId: "j" }),
    ).resolves.toEqual({ status: "retry_pending", reason: "Fake job is retry pending." });

    const expired = createBackgroundJobProcessor(family, {
      claimJob: vi.fn().mockResolvedValue(null),
      getJob: vi.fn().mockResolvedValue({ status: "expired" as const }),
    });
    await expect(
      expired.claimJob({ ownerUserId: "u", deliveryId: "d", jobId: "j" }),
    ).resolves.toEqual({ status: "terminal", reason: "Fake job is expired." });
  });

  it("rethrows a failed processing outcome using the processor error", async () => {
    const processor = createBackgroundJobProcessor(family, {
      processJob: vi
        .fn()
        .mockResolvedValue({ outcome: "failed" as const, error: "provider throttled" }),
    });
    await expect(
      processor.processJob({ ownerUserId: "u", deliveryId: "d", jobId: "j" }),
    ).rejects.toThrow("provider throttled");
  });

  it("does not throw for a non-failed outcome", async () => {
    const processor = createBackgroundJobProcessor(family, {
      processJob: vi.fn().mockResolvedValue({ outcome: "completed" as const }),
    });
    await expect(
      processor.processJob({ ownerUserId: "u", deliveryId: "d", jobId: "j" }),
    ).resolves.toBeUndefined();
  });
});
