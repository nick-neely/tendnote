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

describe("scheduled, revisioned publication", () => {
  const now = new Date("2026-03-08T06:59:30.250Z");

  async function revisedReminderDelivery(store = createInMemoryBackgroundJobDeliveryStore()) {
    const { delivery } = await store.createBackgroundJobDelivery({
      ownerUserId: OWNER,
      jobKind: "reminder_push",
      jobId: "11111111-1111-1111-1111-111111111111",
    });
    const revised = await store.reviseBackgroundJobDelivery({
      ownerUserId: OWNER,
      deliveryId: delivery.id,
      nextAttemptAt: now,
    });
    if (!revised) throw new Error("expected an unfenced revision");
    return { store, delivery: revised };
  }

  it("delays the pointer until the alert time and keeps it past that time for retries", async () => {
    const { store, delivery } = await revisedReminderDelivery();
    const queue = okQueue();

    // 07:30 UTC is 02:30 local on the New York spring-forward night: the delay
    // is plain elapsed time, rounded up so the pointer never arrives early.
    const result = await publishBackgroundJobDelivery({
      store,
      queue,
      ownerUserId: OWNER,
      deliveryId: delivery.id,
      deliverAt: new Date("2026-03-08T07:30:00.000Z"),
      now,
    });

    expect(result.ok).toBe(true);
    expect(result.delivery).toMatchObject({ status: "published", revision: 1 });
    expect(queue.send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          deliveryId: delivery.id,
          jobKind: "reminder_push",
          jobId: delivery.jobId,
          revision: 1,
        },
        idempotencyKey: `reminder_push:${delivery.jobId}:${delivery.topic}:${delivery.id}:r1`,
        delaySeconds: 1830,
        retentionSeconds: 1830 + 24 * 60 * 60,
      }),
    );
  });

  it("caps a far-future pointer at a checkpoint the queue can still hold", async () => {
    const { store, delivery } = await revisedReminderDelivery();
    const queue = okQueue();

    await publishBackgroundJobDelivery({
      store,
      queue,
      ownerUserId: OWNER,
      deliveryId: delivery.id,
      deliverAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      now,
    });

    expect(queue.send).toHaveBeenCalledWith(
      expect.objectContaining({ delaySeconds: 6 * 24 * 60 * 60, retentionSeconds: 604_800 }),
    );
  });

  it("sends a due pointer without delay", async () => {
    const { store, delivery } = await revisedReminderDelivery();
    const queue = okQueue();

    await publishBackgroundJobDelivery({
      store,
      queue,
      ownerUserId: OWNER,
      deliveryId: delivery.id,
      deliverAt: new Date(now.getTime() - 60_000),
      now,
    });

    expect(queue.send).toHaveBeenCalledWith(
      expect.objectContaining({ delaySeconds: 0, retentionSeconds: 24 * 60 * 60 }),
    );
  });

  it("gives every revision its own idempotency key", async () => {
    const { store, delivery } = await revisedReminderDelivery();
    const queue = okQueue();
    await publishBackgroundJobDelivery({
      store,
      queue,
      ownerUserId: OWNER,
      deliveryId: delivery.id,
      now,
    });
    await store.reviseBackgroundJobDelivery({
      ownerUserId: OWNER,
      deliveryId: delivery.id,
      nextAttemptAt: now,
    });
    await publishBackgroundJobDelivery({
      store,
      queue,
      ownerUserId: OWNER,
      deliveryId: delivery.id,
      now,
    });

    const keys = vi.mocked(queue.send).mock.calls.map(([call]) => call.idempotencyKey);
    expect(keys).toEqual([expect.stringMatching(/:r1$/), expect.stringMatching(/:r2$/)]);
  });

  it("never marks a newer revision published on behalf of an older publish", async () => {
    const { store, delivery } = await revisedReminderDelivery();
    let resolveSend: (() => void) | undefined;
    const queue: BackgroundJobQueueSendAdapter = {
      send: vi.fn(
        () =>
          new Promise<{ messageId: string | null }>((resolve) => {
            resolveSend = () => resolve({ messageId: "m-old" });
          }),
      ),
    };

    const oldPublish = publishBackgroundJobDelivery({
      store,
      queue,
      ownerUserId: OWNER,
      deliveryId: delivery.id,
      now,
    });
    await vi.waitFor(() => expect(resolveSend).toBeDefined());
    // An edit lands while the old revision's send is still in flight.
    await store.reviseBackgroundJobDelivery({
      ownerUserId: OWNER,
      deliveryId: delivery.id,
      nextAttemptAt: now,
    });
    resolveSend?.();
    const result = await oldPublish;

    expect(result).toMatchObject({ ok: true, superseded: true });
    await expect(
      store.getBackgroundJobDelivery({ ownerUserId: OWNER, deliveryId: delivery.id }),
    ).resolves.toMatchObject({ revision: 2, status: "pending", publishedAt: null });
  });

  it("sends nothing for a revision that was re-armed before its publish ran", async () => {
    const { store, delivery } = await revisedReminderDelivery();
    // A second edit commits before the first edit's after-commit publish runs.
    await store.reviseBackgroundJobDelivery({
      ownerUserId: OWNER,
      deliveryId: delivery.id,
      nextAttemptAt: now,
    });
    const queue = okQueue();

    const result = await publishBackgroundJobDelivery({
      store,
      queue,
      ownerUserId: OWNER,
      deliveryId: delivery.id,
      deliverAt: new Date(now.getTime() + 60 * 60_000),
      revision: delivery.revision,
      now,
    });

    // Otherwise it would send revision 2's key timed to revision 1's alert,
    // and revision 2's own send would then be deduplicated away.
    expect(result).toMatchObject({ ok: true, superseded: true });
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("leaves an unrevised pointer exactly as it always was", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();
    const { delivery } = await store.createBackgroundJobDelivery({
      ownerUserId: OWNER,
      jobKind: "embedding",
      jobId: "job-9",
    });
    const queue = okQueue();

    await publishBackgroundJobDelivery({
      store,
      queue,
      ownerUserId: OWNER,
      deliveryId: delivery.id,
    });

    const [call] = vi.mocked(queue.send).mock.calls[0] ?? [];
    expect(call?.payload).toEqual({
      deliveryId: delivery.id,
      jobKind: "embedding",
      jobId: "job-9",
    });
    expect(call).not.toHaveProperty("delaySeconds");
    expect(call).not.toHaveProperty("retentionSeconds");
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

  it("authenticates a revision so a genuine pointer cannot be retargeted", () => {
    const revised: BackgroundJobQueuePayload = { ...payload, revision: 3 };
    const signed = attachBackgroundJobQueueSignature(revised, secret);

    expect(verifyBackgroundJobQueueSignature(signed, secret)).toBe(true);
    expect(verifyBackgroundJobQueueSignature({ ...signed, revision: 4 }, secret)).toBe(false);
    expect(verifyBackgroundJobQueueSignature({ ...signed, revisionSig: undefined }, secret)).toBe(
      false,
    );
    expect(verifyBackgroundJobQueueSignature({ ...signed, revision: -1 }, secret)).toBe(false);
    // The legacy tag stays valid on its own, so a consumer rolled back to the
    // pre-revision code still accepts revisioned pointers already in flight.
    const { revision: _revision, revisionSig: _revisionSig, ...legacy } = signed;
    expect(verifyBackgroundJobQueueSignature(legacy, secret)).toBe(true);
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
