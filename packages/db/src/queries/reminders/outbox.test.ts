import { describe, expect, it, vi } from "vitest";
import {
  type BackgroundJobQueueSendAdapter,
  createInMemoryBackgroundJobDeliveryStore,
} from "../background-job-deliveries";
import { armReminderDelivery, scheduleReminderDeliveryOutbox } from "./outbox";

const OWNER = "owner-1";
const JOB = "11111111-1111-1111-1111-111111111111";
const now = new Date("2026-08-14T13:58:00.000Z");
const firstAt = new Date("2026-08-14T14:00:00.000Z");
const replacementAt = new Date("2026-08-14T15:30:00.000Z");

function fakeQueue(): BackgroundJobQueueSendAdapter {
  return { send: vi.fn(async () => ({ messageId: "m" })) };
}

describe("Reminder durable outbox", () => {
  it("publishes a newly committed reminder ahead, delayed to its alert time", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();
    const queue = fakeQueue();

    const delivery = await armReminderDelivery({
      store,
      queue,
      ownerUserId: OWNER,
      jobId: JOB,
      deliverAt: firstAt,
      now,
    });

    expect(queue.send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ jobId: JOB, revision: 1 }),
        delaySeconds: 120,
      }),
    );
    await expect(
      store.getBackgroundJobDelivery({ ownerUserId: OWNER, deliveryId: delivery.id }),
    ).resolves.toMatchObject({ status: "published", revision: 1 });
  });

  it("gives each re-arm a new revision so an edit is never deduplicated away", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();
    const queue = fakeQueue();

    const first = await armReminderDelivery({
      store,
      queue,
      ownerUserId: OWNER,
      jobId: JOB,
      deliverAt: firstAt,
      now,
    });
    const replacement = await armReminderDelivery({
      store,
      queue,
      ownerUserId: OWNER,
      jobId: JOB,
      deliverAt: replacementAt,
      now,
    });

    expect(replacement.id).toBe(first.id);
    const sent = vi.mocked(queue.send).mock.calls.map(([call]) => ({
      key: call.idempotencyKey,
      revision: call.payload.revision,
      delaySeconds: call.delaySeconds,
    }));
    expect(sent).toEqual([
      { key: expect.stringMatching(/:r1$/), revision: 1, delaySeconds: 120 },
      { key: expect.stringMatching(/:r2$/), revision: 2, delaySeconds: 5520 },
    ]);
  });

  it("leaves a recoverable intent when the publish fails, without failing the mutation", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();
    const queue: BackgroundJobQueueSendAdapter = {
      send: vi.fn(async () => {
        throw new Error("provider outage");
      }),
    };

    const delivery = await armReminderDelivery({
      store,
      queue,
      ownerUserId: OWNER,
      jobId: JOB,
      deliverAt: firstAt,
      now,
    });

    await expect(
      store.getBackgroundJobDelivery({ ownerUserId: OWNER, deliveryId: delivery.id }),
    ).resolves.toMatchObject({ status: "publish_failed", revision: 1 });
    const retry = await store.listDueBackgroundJobDeliveries({
      statuses: ["publish_failed"],
      now: new Date(now.getTime() + 5 * 60_000),
      limit: 10,
    });
    expect(retry.map((row) => row.id)).toEqual([delivery.id]);
  });

  it("without a transport, leaves the intent for recovery to publish now", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();

    const delivery = await armReminderDelivery({
      store,
      ownerUserId: OWNER,
      jobId: JOB,
      deliverAt: replacementAt,
      now,
    });

    expect(delivery).toMatchObject({ status: "pending", nextAttemptAt: now, revision: 1 });
  });

  it("with publishing ahead switched off, waits for recovery at the alert time as before", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();
    const queue = fakeQueue();

    const delivery = await armReminderDelivery({
      store,
      queue,
      ownerUserId: OWNER,
      jobId: JOB,
      deliverAt: replacementAt,
      now,
      publishAhead: false,
    });

    expect(queue.send).not.toHaveBeenCalled();
    expect(delivery).toMatchObject({ status: "pending", nextAttemptAt: replacementAt });
    await expect(
      store.listDueBackgroundJobDeliveries({
        statuses: ["pending"],
        now: new Date(replacementAt.getTime() - 1_000),
        limit: 10,
      }),
    ).resolves.toEqual([]);
  });

  it("re-arms an abandoned or published row back to a pending intent", async () => {
    const store = createInMemoryBackgroundJobDeliveryStore();
    const first = await scheduleReminderDeliveryOutbox(store, {
      ownerUserId: OWNER,
      jobId: JOB,
      nextAttemptAt: firstAt,
    });
    await store.updateBackgroundJobDelivery({
      ownerUserId: OWNER,
      deliveryId: first.id,
      status: "abandoned",
    });

    const rearmed = await scheduleReminderDeliveryOutbox(store, {
      ownerUserId: OWNER,
      jobId: JOB,
      nextAttemptAt: replacementAt,
    });

    expect(rearmed).toMatchObject({
      id: first.id,
      status: "pending",
      nextAttemptAt: replacementAt,
      revision: 2,
    });
  });
});
