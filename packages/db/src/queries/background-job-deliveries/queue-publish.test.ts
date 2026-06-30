import { describe, expect, it, vi } from "vitest";
import { createInMemoryBackgroundJobDeliveryStore } from "./in-memory-store";
import { type BackgroundJobQueueSendAdapter, publishBackgroundJobDelivery } from "./queue-publish";

const OWNER = "owner-1";

function okQueue(): BackgroundJobQueueSendAdapter {
  return { send: vi.fn(async () => ({ messageId: "m1" })) };
}

describe("publishBackgroundJobDelivery", () => {
  it("sends the delivery and marks it published on success", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();
    const { delivery } = await store.createBackgroundJobDelivery({
      ownerUserId: OWNER,
      jobKind: "extraction",
      jobId: "job-1",
    });
    const queue = okQueue();

    const result = await publishBackgroundJobDelivery({
      store,
      queue,
      ownerUserId: OWNER,
      deliveryId: delivery.id,
    });

    expect(result.ok).toBe(true);
    expect(result.delivery.status).toBe("published");
    expect(queue.send).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: delivery.topic,
        payload: { deliveryId: delivery.id, jobKind: "extraction", jobId: "job-1" },
        idempotencyKey: `extraction:job-1:${delivery.topic}:${delivery.id}`,
      }),
    );
  });

  it("marks the delivery publish_failed with a retry time when the transport throws", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();
    const { delivery } = await store.createBackgroundJobDelivery({
      ownerUserId: OWNER,
      jobKind: "embedding",
      jobId: "job-2",
    });
    const queue: BackgroundJobQueueSendAdapter = {
      send: vi.fn(async () => {
        throw new Error("queue down");
      }),
    };

    const result = await publishBackgroundJobDelivery({
      store,
      queue,
      ownerUserId: OWNER,
      deliveryId: delivery.id,
    });

    expect(result.ok).toBe(false);
    expect(result.delivery.status).toBe("publish_failed");
    expect(result.delivery.lastError).toContain("queue down");
    expect(result.delivery.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("throws when the delivery does not exist for the owner", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();

    await expect(
      publishBackgroundJobDelivery({
        store,
        queue: okQueue(),
        ownerUserId: OWNER,
        deliveryId: "missing",
      }),
    ).rejects.toThrow("Background job delivery not found.");
  });
});
