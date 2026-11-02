import type { ReminderOccurrenceIntent } from "@tendnote/domain/reminders";
import { describe, expect, it, vi } from "vitest";
import {
  type BackgroundJobQueueSendAdapter,
  createInMemoryBackgroundJobDeliveryStore,
} from "../background-job-deliveries";
import {
  REMINDER_LOST_WAKEUP_GRACE_MS,
  rearmReminderDeliveryJob,
  recoverLostReminderWakeups,
} from "./delivery-wakeups";
import { createInMemoryReminderStore } from "./in-memory-store";
import { armReminderDelivery } from "./outbox";
import { isReminderDeliveryJobClaimable, REMINDER_DELIVERY_LEASE_MS } from "./policy";

const OWNER = "owner-1";
const DUE = new Date("2026-08-14T14:00:00.000Z");
const MINUTE = 60_000;

function intent(id: string): ReminderOccurrenceIntent {
  return {
    id,
    ownerUserId: OWNER,
    recordKind: "follow_up",
    recordId: "22222222-2222-4222-8222-222222222222",
    generalActionId: null,
    scheduleId: "schedule-1",
    occurrenceKey: `follow_up:${id}:2026-08-14`,
    intendedAt: DUE,
    freshUntil: new Date(DUE.getTime() + 15 * 60 * MINUTE),
    status: "pending_installation",
    createdAt: DUE,
    updatedAt: DUE,
  } as ReminderOccurrenceIntent;
}

async function seededJob(store = createInMemoryReminderStore(), id = "intent-1") {
  const { job } = await store.upsertDeliveryJob({
    ownerUserId: OWNER,
    occurrenceIntent: intent(id),
    installationId: `installation-${id}`,
    now: new Date(DUE.getTime() - 60 * MINUTE),
  });
  return { store, job };
}

function queue(): BackgroundJobQueueSendAdapter {
  return { send: vi.fn(async () => ({ messageId: "m" })) };
}

describe("Reminder wake-up recovery", () => {
  it("re-arms an overdue job whose pointer was lost, and leaves healthy ones alone", async () => {
    const { store, job: lost } = await seededJob();
    const { job: missing } = await seededJob(store, "intent-2");
    const { job: retrying } = await seededJob(store, "intent-3");
    const { job: fresh } = await seededJob(store, "intent-4");
    const deliveries = createInMemoryBackgroundJobDeliveryStore();
    const sendNow = queue();
    const before = new Date(DUE.getTime() - 60 * MINUTE);
    const now = new Date(DUE.getTime() + 10 * MINUTE);
    // Published long ago, never consumed: lost.
    await armReminderDelivery({
      store: deliveries,
      queue: sendNow,
      ownerUserId: OWNER,
      jobId: lost.id,
      deliverAt: DUE,
      now: before,
    });
    // Its publish failed: the ordinary outbox recovery owns the retry.
    await armReminderDelivery({
      store: deliveries,
      ownerUserId: OWNER,
      jobId: retrying.id,
      deliverAt: DUE,
      now: before,
    });
    // Re-armed a minute ago: still on its way.
    await armReminderDelivery({
      store: deliveries,
      queue: sendNow,
      ownerUserId: OWNER,
      jobId: fresh.id,
      deliverAt: DUE,
      now: new Date(now.getTime() - MINUTE),
    });
    const recovery = queue();

    const result = await recoverLostReminderWakeups({
      reminderStore: store,
      deliveryStore: deliveries,
      queue: recovery,
      now,
      limit: 25,
    });

    expect(result).toEqual({ scanned: 4, rearmed: 2, expired: 0, failed: 0 });
    const woken = vi.mocked(recovery.send).mock.calls.map(([call]) => call.payload.jobId);
    expect(woken.sort()).toEqual([lost.id, missing.id].sort());
    expect(vi.mocked(recovery.send).mock.calls.every(([call]) => call.delaySeconds === 0)).toBe(
      true,
    );
  });

  it("does not touch a job still inside its grace", async () => {
    const { store } = await seededJob();
    const deliveries = createInMemoryBackgroundJobDeliveryStore();

    const result = await recoverLostReminderWakeups({
      reminderStore: store,
      deliveryStore: deliveries,
      queue: queue(),
      now: new Date(DUE.getTime() + REMINDER_LOST_WAKEUP_GRACE_MS - 1),
      limit: 25,
    });

    expect(result).toEqual({ scanned: 0, rearmed: 0, expired: 0, failed: 0 });
  });

  it("counts a re-arm the provider refused as failed, leaving it for the next pass", async () => {
    const { store } = await seededJob();
    const deliveries = createInMemoryBackgroundJobDeliveryStore();
    const info = vi.fn();

    const result = await recoverLostReminderWakeups({
      reminderStore: store,
      deliveryStore: deliveries,
      queue: {
        send: vi.fn(async () => {
          throw new Error("provider outage");
        }),
      },
      now: new Date(DUE.getTime() + 10 * MINUTE),
      limit: 25,
      logger: { info },
    });

    expect(result).toEqual({ scanned: 1, rearmed: 0, expired: 0, failed: 1 });
    expect(info).toHaveBeenCalledWith("reminder_delivery.lost_wakeups_rearmed", result);
  });

  it("closes a job past its freshness as stale instead of waking it, which bounds retries", async () => {
    const { store, job } = await seededJob();
    // A dispatch that keeps dying mid-flight leaves the job claimed forever.
    await store.claimDeliveryJob({ jobId: job.id, now: DUE });
    const deliveries = createInMemoryBackgroundJobDeliveryStore();
    const recovery = queue();
    const afterFreshness = new Date(job.freshUntil.getTime() + MINUTE);

    const result = await recoverLostReminderWakeups({
      reminderStore: store,
      deliveryStore: deliveries,
      queue: recovery,
      now: afterFreshness,
      limit: 25,
    });

    expect(result).toEqual({ scanned: 1, rearmed: 0, expired: 1, failed: 0 });
    expect(recovery.send).not.toHaveBeenCalled();
    await expect(store.getDeliveryJob(job.id)).resolves.toMatchObject({
      status: "skipped",
      outcome: "suppressed_stale",
    });
    await expect(store.listAuditEntries({ ownerUserId: OWNER })).resolves.toEqual([
      expect.objectContaining({
        action: "reminder.delivery_suppressed",
        metadata: expect.objectContaining({ outcome: "suppressed_stale" }),
      }),
    ]);
    // Closed for good: the next pass has nothing left to retry.
    await expect(
      recoverLostReminderWakeups({
        reminderStore: store,
        deliveryStore: deliveries,
        queue: recovery,
        now: new Date(afterFreshness.getTime() + 10 * MINUTE),
        limit: 25,
      }),
    ).resolves.toMatchObject({ scanned: 0 });
  });

  it("with publishing ahead off, leaves a re-armed wake-up for the cron", async () => {
    const { store } = await seededJob();
    const deliveries = createInMemoryBackgroundJobDeliveryStore();
    const recovery = queue();

    const result = await recoverLostReminderWakeups({
      reminderStore: store,
      deliveryStore: deliveries,
      queue: recovery,
      now: new Date(DUE.getTime() + 10 * MINUTE),
      publishAhead: false,
      limit: 25,
    });

    expect(result).toMatchObject({ rearmed: 1 });
    expect(recovery.send).not.toHaveBeenCalled();
    await expect(
      deliveries.listDueBackgroundJobDeliveries({
        statuses: ["pending"],
        now: new Date(DUE.getTime() + 10 * MINUTE),
        limit: 10,
      }),
    ).resolves.toHaveLength(1);
  });

  it("takes no budget when given none", async () => {
    const { store } = await seededJob();
    await expect(
      recoverLostReminderWakeups({
        reminderStore: store,
        deliveryStore: createInMemoryBackgroundJobDeliveryStore(),
        queue: queue(),
        now: new Date(DUE.getTime() + 10 * MINUTE),
        limit: 0,
      }),
    ).resolves.toEqual({ scanned: 0, rearmed: 0, expired: 0, failed: 0 });
  });

  it("re-arms a job that has completed with nothing", async () => {
    const { store, job } = await seededJob();
    await store.updateDeliveryJob({
      jobId: job.id,
      now: DUE,
      status: "completed",
      outcome: "accepted",
    });

    await expect(
      rearmReminderDeliveryJob({
        reminderStore: store,
        deliveryStore: createInMemoryBackgroundJobDeliveryStore(),
        queue: queue(),
        jobId: job.id,
        now: DUE,
      }),
    ).resolves.toBeNull();
  });
});

describe("Reminder delivery claim lease", () => {
  it("lets a claim be taken over only once its lease has expired", async () => {
    const { store, job } = await seededJob();
    const claimed = await store.claimDeliveryJob({ jobId: job.id, now: DUE });
    if (!claimed) throw new Error("expected a claim");

    expect(isReminderDeliveryJobClaimable(claimed, new Date(DUE.getTime() + MINUTE))).toBe(false);
    await expect(
      store.claimDeliveryJob({ jobId: job.id, now: new Date(DUE.getTime() + MINUTE) }),
    ).resolves.toBeNull();
    const takeoverAt = new Date(DUE.getTime() + REMINDER_DELIVERY_LEASE_MS);
    expect(isReminderDeliveryJobClaimable(claimed, takeoverAt)).toBe(true);
    await expect(store.claimDeliveryJob({ jobId: job.id, now: takeoverAt })).resolves.toMatchObject(
      { status: "running", updatedAt: takeoverAt },
    );
  });

  it("lists an abandoned claim as overdue for recovery", async () => {
    const { store, job } = await seededJob();
    await store.claimDeliveryJob({ jobId: job.id, now: DUE });

    await expect(
      store.listOverdueDeliveryJobs({
        dueBefore: new Date(DUE.getTime() - MINUTE),
        leaseExpiredBefore: DUE,
        limit: 10,
      }),
    ).resolves.toEqual([expect.objectContaining({ id: job.id, status: "running" })]);
  });
});
