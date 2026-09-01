import { describe, expect, it, vi } from "vitest";
import { createInMemoryBackgroundJobDeliveryStore } from "./in-memory-store";
import {
  attachBackgroundJobQueueSignature,
  type BackgroundJobQueuePayload,
  type BackgroundJobQueueSendAdapter,
  publishBackgroundJobDelivery,
  resolveBackgroundJobQueueSecret,
  signBackgroundJobQueuePayload,
  verifyBackgroundJobQueueSignature,
} from "./queue-publish";

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

describe("background job queue callback signatures", () => {
  const secret = "queue-signing-secret";
  const payload: BackgroundJobQueuePayload = {
    deliveryId: "delivery-1",
    jobKind: "extraction",
    jobId: "job-1",
  };

  it("verifies a payload signed with the same secret", () => {
    const signed = attachBackgroundJobQueueSignature(payload, secret);
    expect(signed).toMatchObject(payload);
    expect(typeof signed.sig).toBe("string");
    expect(verifyBackgroundJobQueueSignature(signed, secret)).toBe(true);
  });

  it("rejects a payload signed with a different secret", () => {
    const signed = attachBackgroundJobQueueSignature(payload, "other-secret");
    expect(verifyBackgroundJobQueueSignature(signed, secret)).toBe(false);
  });

  it("rejects a tampered field even with the original signature", () => {
    const signed = attachBackgroundJobQueueSignature(payload, secret);
    expect(verifyBackgroundJobQueueSignature({ ...signed, jobId: "job-2" }, secret)).toBe(false);
    expect(verifyBackgroundJobQueueSignature({ ...signed, jobKind: "embedding" }, secret)).toBe(
      false,
    );
  });

  it("rejects an unsigned payload, a missing tag, and non-objects", () => {
    expect(verifyBackgroundJobQueueSignature(payload, secret)).toBe(false);
    expect(verifyBackgroundJobQueueSignature({ ...payload, sig: "not-hex" }, secret)).toBe(false);
    expect(verifyBackgroundJobQueueSignature(null, secret)).toBe(false);
    expect(verifyBackgroundJobQueueSignature("string", secret)).toBe(false);
  });

  it("signs deterministically for the same tuple and secret", () => {
    expect(signBackgroundJobQueuePayload(payload, secret)).toBe(
      signBackgroundJobQueuePayload(payload, secret),
    );
  });
});

describe("resolveBackgroundJobQueueSecret", () => {
  it("prefers the dedicated secret and falls back to BETTER_AUTH_SECRET", () => {
    expect(
      resolveBackgroundJobQueueSecret({
        BACKGROUND_JOB_QUEUE_SECRET: "dedicated",
        BETTER_AUTH_SECRET: "auth",
      }),
    ).toBe("dedicated");
    expect(resolveBackgroundJobQueueSecret({ BETTER_AUTH_SECRET: "auth" })).toBe("auth");
  });

  it("trims whitespace and returns undefined when neither is set", () => {
    expect(resolveBackgroundJobQueueSecret({ BACKGROUND_JOB_QUEUE_SECRET: "  padded  " })).toBe(
      "padded",
    );
    expect(
      resolveBackgroundJobQueueSecret({
        BACKGROUND_JOB_QUEUE_SECRET: "   ",
        BETTER_AUTH_SECRET: "",
      }),
    ).toBeUndefined();
    expect(resolveBackgroundJobQueueSecret({})).toBeUndefined();
  });
});
