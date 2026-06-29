import { describe, expect, it } from "vitest";
import { createInMemoryBackgroundJobDeliveryStore } from "./in-memory-store";
import { BACKGROUND_JOB_TOPICS, topicForBackgroundJob } from "./topics";

describe("background job delivery ledger", () => {
  it("creates owner-scoped delivery intents using the typed topic map", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();

    const { delivery, created } = await store.createBackgroundJobDelivery({
      ownerUserId: "user-1",
      jobKind: "extraction",
      jobId: "00000000-0000-0000-0000-000000000001",
    });

    expect(created).toBe(true);
    expect(delivery).toMatchObject({
      ownerUserId: "user-1",
      jobKind: "extraction",
      jobId: "00000000-0000-0000-0000-000000000001",
      topic: BACKGROUND_JOB_TOPICS.extraction,
      status: "pending",
      attempts: 0,
      lastError: null,
      publishedAt: null,
    });
    expect(topicForBackgroundJob("embedding")).toBe(BACKGROUND_JOB_TOPICS.embedding);
  });

  it("returns the existing intent for the same job kind, job id, and topic", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();
    const input = {
      ownerUserId: "user-1",
      jobKind: "embedding" as const,
      jobId: "00000000-0000-0000-0000-000000000002",
    };

    const first = await store.createBackgroundJobDelivery(input);
    const second = await store.createBackgroundJobDelivery(input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.delivery.id).toBe(first.delivery.id);
  });

  it("tracks publish success separately from processor status", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();
    const { delivery } = await store.createBackgroundJobDelivery({
      ownerUserId: "user-1",
      jobKind: "extraction",
      jobId: "00000000-0000-0000-0000-000000000003",
    });
    const publishedAt = new Date("2026-06-29T12:00:00.000Z");

    const published = await store.markBackgroundJobDeliveryPublished({
      ownerUserId: "user-1",
      deliveryId: delivery.id,
      publishedAt,
    });

    expect(published.status).toBe("published");
    expect(published.publishedAt).toEqual(publishedAt);
    expect(published.lastError).toBeNull();
  });

  it("records publish failures with retry scheduling", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();
    const { delivery } = await store.createBackgroundJobDelivery({
      ownerUserId: "user-1",
      jobKind: "embedding",
      jobId: "00000000-0000-0000-0000-000000000004",
    });
    const nextAttemptAt = new Date("2026-06-29T12:05:00.000Z");

    const failed = await store.markBackgroundJobDeliveryPublishFailed({
      ownerUserId: "user-1",
      deliveryId: delivery.id,
      error: " queue provider unavailable ",
      nextAttemptAt,
    });

    expect(failed).toMatchObject({
      status: "publish_failed",
      attempts: 1,
      lastError: "queue provider unavailable",
      nextAttemptAt,
    });
  });

  it("lists by owner and status for targeted inspection", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();
    const first = await store.createBackgroundJobDelivery({
      ownerUserId: "user-1",
      jobKind: "extraction",
      jobId: "00000000-0000-0000-0000-000000000005",
    });
    await store.createBackgroundJobDelivery({
      ownerUserId: "user-2",
      jobKind: "extraction",
      jobId: "00000000-0000-0000-0000-000000000006",
    });
    await store.updateBackgroundJobDelivery({
      deliveryId: first.delivery.id,
      status: "abandoned",
      lastError: "processor job is terminal",
    });

    await expect(
      store.listBackgroundJobDeliveries({ ownerUserId: "user-1", status: "abandoned" }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: first.delivery.id,
        ownerUserId: "user-1",
        status: "abandoned",
      }),
    ]);
  });
});
