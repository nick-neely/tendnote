import {
  type BackgroundJobQueueSendAdapter,
  type BackgroundJobQueueSendInput,
  createInMemoryBackgroundJobDeliveryStore,
  publishBackgroundJobDelivery,
  QUEUE_MAX_DELAY_SECONDS,
  QUEUE_RETRY_HEADROOM_SECONDS,
} from "@tendnote/db/queries/background-job-deliveries";
import {
  armReminderDelivery,
  createInMemoryReminderStore,
  createReminderService,
  type ReminderPushSender,
  type ReminderRecord,
} from "@tendnote/db/queries/reminders";
import { describe, expect, it, vi } from "vitest";
import { recoverBackgroundJobDeliveries } from "./recovery";
import { consumeReminderQueueMessage } from "./reminder-queue";

/**
 * Reminder wake-ups end to end, over in-memory stores, a fake clock, and a fake
 * queue that behaves like the provider: a message is invisible until its delay
 * passes, gone once its retention does, and may be delivered more than once.
 * Each scenario drives the real reminder service, outbox arming and queue
 * consumer, and asserts only what reaches the push sender.
 */
const OWNER = "owner-1";
const FOLLOW_UP = "22222222-2222-4222-8222-222222222222";
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;

type QueuedMessage = {
  send: BackgroundJobQueueSendInput;
  sentAt: number;
  visibleAt: number;
  expiresAt: number;
  deliveries: number;
};

function createHarness(input: { occursAt: Date; startAt: Date }) {
  let clock = input.startAt.getTime();
  const now = () => new Date(clock);
  const reminders = createInMemoryReminderStore();
  const deliveries = createInMemoryBackgroundJobDeliveryStore();
  // Lets a scenario land a concurrent change just after some reader loaded a
  // job, so the reader goes on to act on what is by then a stale snapshot.
  const readJob = reminders.getDeliveryJob;
  const raceAfterNextJobRead: Array<() => Promise<unknown>> = [];
  reminders.getDeliveryJob = async (jobId) => {
    const job = await readJob(jobId);
    await raceAfterNextJobRead.shift()?.();
    return job;
  };
  const messages: QueuedMessage[] = [];
  const transport = {
    up: true,
    registered: true,
    publishAhead: true,
    failNextStatusWrite: false,
    /** Write outbox rows as pre-revision code did: unrevised, due at the alert time. */
    legacyRows: false,
  };
  const markPublished = deliveries.markBackgroundJobDeliveryPublished;
  deliveries.markBackgroundJobDeliveryPublished = async (values) => {
    if (transport.failNextStatusWrite) {
      transport.failNextStatusWrite = false;
      throw new Error("database unavailable after send");
    }
    return markPublished(values);
  };
  const queue: BackgroundJobQueueSendAdapter = {
    async send(send) {
      if (!transport.up) throw new Error("provider outage");
      // The provider deduplicates a repeated key within its window.
      if (!messages.some((message) => message.send.idempotencyKey === send.idempotencyKey)) {
        const delay = (send.delaySeconds ?? 0) * SECOND;
        messages.push({
          send,
          sentAt: clock,
          visibleAt: clock + delay,
          expiresAt: clock + (send.retentionSeconds ?? QUEUE_RETRY_HEADROOM_SECONDS) * SECOND,
          deliveries: 0,
        });
      }
      return { messageId: `m-${messages.length}` };
    },
  };
  const record: ReminderRecord = {
    id: FOLLOW_UP,
    kind: "follow_up",
    ownerUserId: OWNER,
    title: "Check in with Morgan",
    status: "open",
    occursAt: input.occursAt,
    timeSemantics: "date_only",
    recurrence: null,
    sensitivity: "normal",
    scope: "private",
    personId: "person-1",
  };
  const standing = { authorized: true };
  const service = createReminderService({
    store: reminders,
    loadReminderRecord: async () => ({ ...record }),
    authorizeSubscription: async () => standing.authorized,
    checkPushEndpoint: async () => ({
      status: "allowed",
      host: "push.example.test",
      addresses: [],
    }),
    scheduleDelivery: async (values) => {
      if (transport.legacyRows) {
        await deliveries.createBackgroundJobDelivery({
          ownerUserId: values.ownerUserId,
          jobKind: "reminder_push",
          jobId: values.jobId,
          nextAttemptAt: values.nextAttemptAt,
        });
        return;
      }
      await armReminderDelivery({
        store: deliveries,
        ...(transport.registered ? { queue } : {}),
        ownerUserId: values.ownerUserId,
        jobId: values.jobId,
        deliverAt: values.nextAttemptAt,
        now: now(),
        publishAhead: transport.publishAhead,
      });
    },
  });
  const pushes: Array<{ endpoint: string; at: number }> = [];
  let failNextPush = false;
  const sender: ReminderPushSender = vi.fn(async ({ subscription }) => {
    if (failNextPush) {
      failNextPush = false;
      throw new Error("push provider unavailable");
    }
    pushes.push({ endpoint: subscription.endpoint, at: clock });
    return { status: "accepted" as const };
  });

  async function consume(message: QueuedMessage) {
    message.deliveries += 1;
    return consumeReminderQueueMessage({
      payload: message.send.payload,
      metadata: { topicName: message.send.topic, deliveryCount: message.deliveries },
      deliveryStore: deliveries,
      reminderStore: reminders,
      getJob: reminders.getDeliveryJob,
      dispatch: service.dispatchReminder,
      sender,
      queue,
      now: now(),
    });
  }

  return {
    record,
    standing,
    transport,
    queue,
    /** Runs `change` right after the next job read returns its (soon stale) result. */
    afterNextJobRead(change: () => Promise<unknown>) {
      raceAfterNextJobRead.push(change);
    },
    /** One recovery cron pass at the current time. */
    recover() {
      return recoverBackgroundJobDeliveries({
        limit: 25,
        lostReminderWakeupLimit: 25,
        now: now(),
        store: deliveries,
        queue,
        reminderStore: reminders,
      });
    },
    service,
    reminders,
    deliveries,
    messages,
    pushes,
    failNextPush: () => {
      failNextPush = true;
    },
    now,
    setClock(at: Date | number) {
      clock = typeof at === "number" ? at : at.getTime();
    },
    consume,
    /** Advances the clock to `at`, delivering every message that became visible on the way. */
    async runUntil(at: Date | number) {
      const target = typeof at === "number" ? at : at.getTime();
      for (;;) {
        const next = messages
          .filter(
            (message) =>
              message.deliveries === 0 &&
              message.visibleAt <= target &&
              // Gone once retention passes, however late the consumer looks.
              message.expiresAt > Math.max(clock, message.visibleAt),
          )
          .sort((left, right) => left.visibleAt - right.visibleAt)[0];
        if (!next) break;
        clock = Math.max(clock, next.visibleAt);
        await consume(next);
      }
      clock = target;
    },
    /** Opt in, then register: the order the product requires, after a reminder exists. */
    async registerInstallation(clientInstallationId: string, endpoint: string) {
      await service.beginReminderInstallationOptIn({
        ownerUserId: OWNER,
        clientInstallationId,
        now: now(),
      });
      return service.registerReminderInstallation({
        ownerUserId: OWNER,
        clientInstallationId,
        subscription: { endpoint, expirationTime: null, keys: { p256dh: "p256dh", auth: "auth" } },
        now: now(),
      });
    },
    async save(localTime: string, timeZone = "America/Chicago") {
      return service.saveReminder({
        ownerUserId: OWNER,
        recordKind: "follow_up",
        recordId: FOLLOW_UP,
        clientInstallationId: "browser-installation-1",
        timeZone,
        schedule: { kind: "exact", localTime },
        now: now(),
      });
    },
    async jobs() {
      return reminders.listDeliveryJobs({ ownerUserId: OWNER });
    },
  };
}

type Harness = ReturnType<typeof createHarness>;

async function savedWithOneInstallation(harness: Harness, localTime: string, timeZone?: string) {
  await harness.save(localTime, timeZone);
  await harness.registerInstallation("browser-installation-1", "https://push.example.test/a");
  const [job] = await harness.jobs();
  if (!job) throw new Error("expected one delivery job");
  return job;
}

describe("Reminder wake-ups through delayed queue delivery", () => {
  it.each([
    // Chicago, an arbitrary minute.
    ["America/Chicago", "09:17", "2026-08-14T00:00:00.000Z"],
    // Kathmandu's +05:45 offset.
    ["Asia/Kathmandu", "07:43", "2026-08-14T00:00:00.000Z"],
    // New York's spring-forward night: 02:30 does not exist locally.
    ["America/New_York", "02:30", "2026-03-08T00:00:00.000Z"],
    // And the fall-back night, when 01:30 happens twice.
    ["America/New_York", "01:30", "2026-11-01T00:00:00.000Z"],
  ])(
    "in %s at %s, publishes on save and sends once at the alert time, never before",
    async (timeZone, localTime, occursAt) => {
      const harness = createHarness({
        occursAt: new Date(occursAt),
        startAt: new Date(new Date(occursAt).getTime() - 3 * DAY),
      });
      const job = await savedWithOneInstallation(harness, localTime, timeZone);

      // Publishable immediately, with no cron scan: the pointer is already queued.
      expect(harness.messages.at(-1)?.send.delaySeconds).toBe(
        Math.ceil((job.intendedAt.getTime() - harness.now().getTime()) / SECOND),
      );

      await harness.runUntil(job.intendedAt.getTime() - SECOND);
      expect(harness.pushes).toEqual([]);
      await harness.runUntil(job.intendedAt.getTime() + 10 * SECOND);
      expect(harness.pushes).toEqual([
        { endpoint: "https://push.example.test/a", at: job.intendedAt.getTime() },
      ]);
    },
  );

  it("delivers a duplicate callback without a second push", async () => {
    const harness = createHarness({
      occursAt: new Date("2026-08-14T00:00:00.000Z"),
      startAt: new Date("2026-08-13T12:00:00.000Z"),
    });
    const job = await savedWithOneInstallation(harness, "09:00");
    await harness.runUntil(job.intendedAt);
    const delivered = harness.messages.find((message) => message.deliveries > 0);
    if (!delivered) throw new Error("expected a delivered pointer");

    await harness.consume(delivered);
    await harness.consume(delivered);

    expect(harness.pushes).toHaveLength(1);
  });

  it("sends only the current revision after edits later and then earlier", async () => {
    const harness = createHarness({
      occursAt: new Date("2026-08-14T00:00:00.000Z"),
      startAt: new Date("2026-08-14T12:00:00.000Z"),
    });
    await savedWithOneInstallation(harness, "09:00");
    await harness.save("11:30");
    await harness.save("10:15");
    const [job] = await harness.jobs();

    await harness.runUntil(new Date("2026-08-14T18:00:00.000Z"));

    // 10:15 Chicago, once: the 09:00 and 11:30 pointers both arrived and no-oped.
    expect(job?.intendedAt).toEqual(new Date("2026-08-14T15:15:00.000Z"));
    expect(harness.pushes).toEqual([
      { endpoint: "https://push.example.test/a", at: Date.parse("2026-08-14T15:15:00.000Z") },
    ]);
    // One pointer per save; the superseded ones arrived and changed nothing,
    // not even to re-arm a wake-up of their own.
    expect(harness.messages).toHaveLength(3);
    expect(harness.messages.every((message) => message.deliveries === 1)).toBe(true);
  });

  it("re-arms a pointer that arrives early instead of dropping the only wake-up", async () => {
    const harness = createHarness({
      occursAt: new Date("2026-08-14T00:00:00.000Z"),
      startAt: new Date("2026-08-14T12:00:00.000Z"),
    });
    const job = await savedWithOneInstallation(harness, "09:00");
    const [pointer] = harness.messages;
    if (!pointer) throw new Error("expected a pointer");

    harness.setClock(job.intendedAt.getTime() - 30 * SECOND);
    await harness.consume(pointer);
    expect(harness.pushes).toEqual([]);
    expect(harness.messages.at(-1)?.send.delaySeconds).toBe(30);

    await harness.runUntil(job.intendedAt.getTime() + MINUTE);
    expect(harness.pushes).toHaveLength(1);
  });

  it("reaches a reminder months away through bounded checkpoints, each retained past its hop", async () => {
    const harness = createHarness({
      occursAt: new Date("2026-11-20T00:00:00.000Z"),
      startAt: new Date("2026-08-14T12:00:00.000Z"),
    });
    const job = await savedWithOneInstallation(harness, "09:00");

    await harness.runUntil(job.intendedAt.getTime() + MINUTE);

    expect(harness.pushes).toEqual([
      { endpoint: "https://push.example.test/a", at: job.intendedAt.getTime() },
    ]);
    for (const message of harness.messages) {
      expect(message.send.delaySeconds).toBeLessThanOrEqual(QUEUE_MAX_DELAY_SECONDS);
      expect(message.expiresAt - message.visibleAt).toBe(QUEUE_RETRY_HEADROOM_SECONDS * SECOND);
    }
    const keys = harness.messages.map((message) => message.send.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(harness.messages.length).toBeGreaterThan(Math.floor(98 / 6));
  });

  it("suppresses a pointer whose reminder was cleared, completed, or lost standing", async () => {
    for (const change of ["cleared", "completed", "revoked"] as const) {
      const harness = createHarness({
        occursAt: new Date("2026-08-14T00:00:00.000Z"),
        startAt: new Date("2026-08-14T12:00:00.000Z"),
      });
      const job = await savedWithOneInstallation(harness, "09:00");
      if (change === "cleared") {
        await harness.service.clearReminder({
          ownerUserId: OWNER,
          recordKind: "follow_up",
          recordId: FOLLOW_UP,
          now: harness.now(),
        });
      } else if (change === "completed") {
        harness.record.status = "completed";
      } else {
        harness.standing.authorized = false;
      }

      await harness.runUntil(job.intendedAt.getTime() + MINUTE);

      expect({ change, pushes: harness.pushes }).toEqual({ change, pushes: [] });
    }
  });

  it("wakes each installation once, skips a disabled one, and re-arms a reinstall", async () => {
    const harness = createHarness({
      occursAt: new Date("2026-08-14T00:00:00.000Z"),
      startAt: new Date("2026-08-14T12:00:00.000Z"),
    });
    await harness.save("09:00");
    await harness.registerInstallation("browser-installation-1", "https://push.example.test/a");
    const phone = await harness.registerInstallation(
      "phone-installation-2",
      "https://push.example.test/b",
    );
    await harness.service.disableReminderInstallation({
      ownerUserId: OWNER,
      installationId: phone.installation.id,
      reason: "remote_revocation",
      now: harness.now(),
    });
    await harness.registerInstallation("phone-installation-2", "https://push.example.test/b2");

    await harness.runUntil(new Date("2026-08-14T15:00:00.000Z"));

    expect(harness.pushes.map((push) => push.endpoint).sort()).toEqual([
      "https://push.example.test/a",
      "https://push.example.test/b2",
    ]);
  });

  it("gives a transient push failure's retry its own pointer", async () => {
    const harness = createHarness({
      occursAt: new Date("2026-08-14T00:00:00.000Z"),
      startAt: new Date("2026-08-14T12:00:00.000Z"),
    });
    const job = await savedWithOneInstallation(harness, "09:00");
    harness.failNextPush();

    await harness.runUntil(job.intendedAt.getTime() + 10 * MINUTE);

    // The retry would once have reused the first pointer's idempotency key and
    // been deduplicated away; now it is sent five minutes later.
    expect(harness.pushes).toEqual([
      { endpoint: "https://push.example.test/a", at: job.intendedAt.getTime() + 5 * MINUTE },
    ]);
  });

  it("suppresses only the stale alert when a pointer is held past freshness", async () => {
    const harness = createHarness({
      occursAt: new Date("2026-08-14T00:00:00.000Z"),
      startAt: new Date("2026-08-14T12:00:00.000Z"),
    });
    const job = await savedWithOneInstallation(harness, "09:00");
    const [pointer] = harness.messages;
    if (!pointer) throw new Error("expected a pointer");

    // A hold redelivers the message until it lifts, after the alert went stale.
    harness.setClock(job.freshUntil.getTime() + MINUTE);
    await harness.consume(pointer);

    expect(harness.pushes).toEqual([]);
    await expect(harness.reminders.getDeliveryJob(job.id)).resolves.toMatchObject({
      status: "skipped",
      outcome: "suppressed_stale",
    });
    await expect(
      harness.reminders.listSchedules({
        ownerUserId: OWNER,
        recordKind: "follow_up",
        recordId: FOLLOW_UP,
      }),
    ).resolves.toHaveLength(1);
  });
});

describe("Reminder wake-up recovery", () => {
  const occursAt = new Date("2026-08-14T00:00:00.000Z");
  const startAt = new Date("2026-08-14T12:00:00.000Z");
  const dueAt = Date.parse("2026-08-14T14:00:00.000Z");

  it("survives a provider outage at save time and still sends on time", async () => {
    const harness = createHarness({ occursAt, startAt });
    harness.transport.up = false;
    await savedWithOneInstallation(harness, "09:00");
    await expect(
      harness.deliveries.listBackgroundJobDeliveries({ ownerUserId: OWNER }),
    ).resolves.toEqual([expect.objectContaining({ status: "publish_failed" })]);

    // Cron passes during the outage fail again, harmlessly.
    harness.setClock(startAt.getTime() + 10 * MINUTE);
    await harness.recover();
    harness.transport.up = true;
    harness.setClock(startAt.getTime() + 20 * MINUTE);
    await harness.recover();
    await harness.runUntil(dueAt + MINUTE);

    expect(harness.pushes).toEqual([{ endpoint: "https://push.example.test/a", at: dueAt }]);
  });

  it("resolves an accepted send whose status write failed without a duplicate", async () => {
    const harness = createHarness({ occursAt, startAt });
    harness.transport.failNextStatusWrite = true;
    await harness.save("09:00");
    await harness.registerInstallation("browser-installation-1", "https://push.example.test/a");
    await expect(
      harness.deliveries.listBackgroundJobDeliveries({ ownerUserId: OWNER }),
    ).resolves.toEqual([expect.objectContaining({ status: "pending" })]);

    // Recovery republishes the same revision under the same key, which the
    // provider deduplicates; the one accepted pointer still wakes the job.
    harness.setClock(startAt.getTime() + 10 * MINUTE);
    await harness.recover();
    await harness.runUntil(dueAt + MINUTE);

    expect(harness.messages).toHaveLength(1);
    expect(harness.pushes).toEqual([{ endpoint: "https://push.example.test/a", at: dueAt }]);
  });

  it("processes a current pointer that arrives before its publish was recorded", async () => {
    const harness = createHarness({ occursAt, startAt });
    harness.transport.failNextStatusWrite = true;
    await harness.save("09:00");
    await harness.registerInstallation("browser-installation-1", "https://push.example.test/a");

    await harness.runUntil(dueAt + MINUTE);

    expect(harness.pushes).toEqual([{ endpoint: "https://push.example.test/a", at: dueAt }]);
  });

  it("publishes an intent left behind when the process died before publishing", async () => {
    const harness = createHarness({ occursAt, startAt });
    harness.transport.registered = false;
    await savedWithOneInstallation(harness, "09:00");
    expect(harness.messages).toEqual([]);

    harness.setClock(startAt.getTime() + 10 * MINUTE);
    await harness.recover();
    expect(harness.messages.at(-1)?.send.delaySeconds).toBe(110 * 60);
    await harness.runUntil(dueAt + MINUTE);

    expect(harness.pushes).toEqual([{ endpoint: "https://push.example.test/a", at: dueAt }]);
  });

  it("re-arms a wake-up the queue lost, on the next pass after its grace", async () => {
    const harness = createHarness({ occursAt, startAt });
    await savedWithOneInstallation(harness, "09:00");
    harness.messages.splice(0); // the provider dropped it, or it expired during a hold

    harness.setClock(dueAt + 3 * MINUTE);
    await expect(harness.recover()).resolves.toMatchObject({
      lostReminderWakeups: { scanned: 0, rearmed: 0 },
    });
    harness.setClock(dueAt + 10 * MINUTE);
    await expect(harness.recover()).resolves.toMatchObject({
      lostReminderWakeups: { scanned: 1, rearmed: 1, failed: 0 },
    });
    await harness.runUntil(dueAt + 11 * MINUTE);

    expect(harness.pushes).toEqual([
      { endpoint: "https://push.example.test/a", at: dueAt + 10 * MINUTE },
    ]);
  });

  it("does not replace a pointer that is merely on its way", async () => {
    const harness = createHarness({ occursAt, startAt });
    await savedWithOneInstallation(harness, "09:00");
    harness.messages.splice(0);
    harness.setClock(dueAt + 10 * MINUTE);
    await harness.recover();
    const before = harness.messages.length;

    // The re-armed pointer has not been consumed yet when the next pass runs.
    harness.setClock(dueAt + 12 * MINUTE);
    await harness.recover();

    expect(harness.messages).toHaveLength(before);
  });

  it("takes over a dispatch whose process died holding the claim", async () => {
    const harness = createHarness({ occursAt, startAt });
    const job = await savedWithOneInstallation(harness, "09:00");
    harness.setClock(dueAt);
    await harness.reminders.claimDeliveryJob({ jobId: job.id, now: harness.now() });
    const [pointer] = harness.messages;
    if (!pointer) throw new Error("expected a pointer");
    pointer.deliveries = 1; // consumed by the process that then died

    harness.setClock(dueAt + 10 * MINUTE);
    await harness.recover();
    await harness.runUntil(dueAt + 11 * MINUTE);

    expect(harness.pushes).toEqual([
      { endpoint: "https://push.example.test/a", at: dueAt + 10 * MINUTE },
    ]);
  });

  it("gives a job that completed no wake-up at all", async () => {
    const harness = createHarness({ occursAt, startAt });
    harness.transport.registered = false;
    const job = await savedWithOneInstallation(harness, "09:00");
    await harness.reminders.updateDeliveryJob({
      jobId: job.id,
      now: harness.now(),
      status: "skipped",
      outcome: "suppressed_ineligible",
    });

    harness.setClock(startAt.getTime() + 10 * MINUTE);
    await expect(harness.recover()).resolves.toMatchObject({ abandoned: 1, republished: 0 });
    expect(harness.messages).toEqual([]);
  });

  it("with publishing ahead switched off, falls back to the cron at the alert time", async () => {
    const harness = createHarness({ occursAt, startAt });
    // A pointer published ahead before the switch is flipped...
    await savedWithOneInstallation(harness, "09:00");
    harness.transport.publishAhead = false;
    // ...is superseded by an edit made afterwards, which only the cron publishes.
    await harness.save("09:20");

    harness.setClock(dueAt + 10 * SECOND);
    await harness.runUntil(dueAt + 10 * SECOND);
    await harness.recover();
    expect(harness.pushes).toEqual([]);
    harness.setClock(dueAt + 20 * MINUTE);
    await harness.recover();
    await harness.runUntil(dueAt + 21 * MINUTE);

    expect(harness.pushes).toEqual([
      { endpoint: "https://push.example.test/a", at: dueAt + 20 * MINUTE },
    ]);
  });

  it("recovers a wake-up whose message expired during a hold longer than its retention", async () => {
    const harness = createHarness({ occursAt, startAt });
    await savedWithOneInstallation(harness, "09:00");
    const [pointer] = harness.messages;
    if (!pointer) throw new Error("expected a pointer");

    // A Service-Wide Hold refuses every callback and pauses the cron until it
    // lifts; by then the provider has dropped the message.
    harness.setClock(pointer.expiresAt + MINUTE);
    await harness.runUntil(pointer.expiresAt + MINUTE);
    expect(pointer.deliveries).toBe(0);
    expect(harness.pushes).toEqual([]);
    await expect(harness.recover()).resolves.toMatchObject({
      lostReminderWakeups: { expired: 1, rearmed: 0 },
    });

    // The stale alert is suppressed, once, and the reminder itself stays.
    const [job] = await harness.jobs();
    expect(job).toMatchObject({ status: "skipped", outcome: "suppressed_stale" });
    await expect(
      harness.reminders.listSchedules({
        ownerUserId: OWNER,
        recordKind: "follow_up",
        recordId: FOLLOW_UP,
      }),
    ).resolves.toHaveLength(1);
  });

  it("with publishing ahead off, an early callback leaves its next wake-up to the cron", async () => {
    const harness = createHarness({ occursAt, startAt });
    await savedWithOneInstallation(harness, "09:00");
    harness.transport.publishAhead = false;
    const [pointer] = harness.messages;
    if (!pointer) throw new Error("expected a pointer");
    vi.stubEnv("REMINDER_DELIVERY_PUBLISH_AHEAD", "off");
    try {
      harness.setClock(dueAt - MINUTE);
      await harness.consume(pointer);
      expect(harness.messages).toHaveLength(1);

      harness.setClock(dueAt + 10 * MINUTE);
      await harness.recover();
      await harness.runUntil(dueAt + 11 * MINUTE);
    } finally {
      vi.unstubAllEnvs();
    }

    expect(harness.pushes).toEqual([
      { endpoint: "https://push.example.test/a", at: dueAt + 10 * MINUTE },
    ]);
  });

  it("never sends an edit's newer revision with recovery's stale delivery time", async () => {
    const harness = createHarness({ occursAt, startAt });
    harness.transport.registered = false;
    await savedWithOneInstallation(harness, "13:00");
    harness.transport.registered = true;
    harness.setClock(startAt.getTime() + 10 * MINUTE);
    // Recovery reads the job (due 13:00); the owner then moves it to 09:00 on
    // a runtime whose own publish has not happened yet, so recovery's send
    // would otherwise claim the new revision's key with the old time first.
    harness.afterNextJobRead(async () => {
      harness.transport.registered = false;
      await harness.save("09:00");
      harness.transport.registered = true;
    });

    await harness.recover();
    harness.setClock(startAt.getTime() + 20 * MINUTE);
    await harness.recover();
    await harness.runUntil(dueAt + 5 * 60 * MINUTE);

    expect(harness.pushes).toEqual([{ endpoint: "https://push.example.test/a", at: dueAt }]);
  });

  it("never lets a checkpoint re-arm supersede an edit made while it read the job", async () => {
    const harness = createHarness({ occursAt, startAt });
    const job = await savedWithOneInstallation(harness, "13:00");
    const [pointer] = harness.messages;
    if (!pointer) throw new Error("expected a pointer");
    harness.setClock(startAt.getTime() + MINUTE);
    // The early callback's checkpoint reads the job (due 13:00) on its second
    // read; the owner moves it to 09:00 before the checkpoint re-arms.
    harness.afterNextJobRead(async () => undefined);
    harness.afterNextJobRead(() => harness.save("09:00"));

    await harness.consume(pointer);
    await harness.runUntil(job.intendedAt.getTime() + MINUTE);

    expect(harness.pushes).toEqual([{ endpoint: "https://push.example.test/a", at: dueAt }]);
  });

  it("fences a checkpoint woken by a pointer from before revisions existed", async () => {
    const harness = createHarness({ occursAt, startAt });
    harness.transport.legacyRows = true;
    const job = await savedWithOneInstallation(harness, "13:00");
    harness.transport.legacyRows = false;
    const [legacy] = await harness.deliveries.listBackgroundJobDeliveries({ ownerUserId: OWNER });
    if (!legacy) throw new Error("expected a legacy delivery");
    expect(legacy.revision).toBe(0);
    // A pointer the old code published, arriving while the job is not yet due.
    await publishBackgroundJobDelivery({
      store: harness.deliveries,
      queue: harness.queue,
      ownerUserId: OWNER,
      deliveryId: legacy.id,
      now: harness.now(),
    });
    const [pointer] = harness.messages;
    if (!pointer) throw new Error("expected a pointer");
    expect(pointer.send.payload).not.toHaveProperty("revision");
    // Its checkpoint reads the job (due 13:00); the owner moves it to 09:00.
    harness.afterNextJobRead(async () => undefined);
    harness.afterNextJobRead(() => harness.save("09:00"));

    await harness.consume(pointer);
    await harness.runUntil(job.intendedAt.getTime() + MINUTE);

    expect(harness.pushes).toEqual([{ endpoint: "https://push.example.test/a", at: dueAt }]);
  });

  it("leaves a delivery alone while its job is being dispatched", async () => {
    const harness = createHarness({ occursAt, startAt });
    harness.transport.failNextStatusWrite = true;
    const job = await savedWithOneInstallation(harness, "09:00");
    harness.setClock(dueAt);
    await harness.reminders.claimDeliveryJob({ jobId: job.id, now: harness.now() });

    harness.setClock(dueAt + MINUTE);
    await expect(harness.recover()).resolves.toMatchObject({ abandoned: 0, republished: 0 });

    await expect(
      harness.deliveries.listBackgroundJobDeliveries({ ownerUserId: OWNER }),
    ).resolves.toEqual([expect.objectContaining({ status: "pending" })]);
  });

  it("never abandons a revision re-armed after recovery inspected the job", async () => {
    const harness = createHarness({ occursAt, startAt });
    harness.transport.registered = false;
    const job = await savedWithOneInstallation(harness, "09:00");
    await harness.reminders.updateDeliveryJob({
      jobId: job.id,
      now: harness.now(),
      status: "skipped",
      outcome: "suppressed_revoked",
    });
    const [delivery] = await harness.deliveries.listBackgroundJobDeliveries({ ownerUserId: OWNER });
    if (!delivery) throw new Error("expected a delivery");
    harness.setClock(startAt.getTime() + 10 * MINUTE);
    // Recovery reads the job as finished; a reinstall re-arms it meanwhile.
    harness.afterNextJobRead(() =>
      harness.deliveries.reviseBackgroundJobDelivery({
        ownerUserId: OWNER,
        deliveryId: delivery.id,
        nextAttemptAt: harness.now(),
      }),
    );

    await expect(harness.recover()).resolves.toMatchObject({ abandoned: 0 });

    await expect(
      harness.deliveries.getBackgroundJobDelivery({ ownerUserId: OWNER, deliveryId: delivery.id }),
    ).resolves.toMatchObject({ status: "pending", revision: delivery.revision + 1 });
  });

  it("replaces a lost checkpoint hop before the far-off alert it leads to is late", async () => {
    const harness = createHarness({
      occursAt: new Date("2026-11-20T00:00:00.000Z"),
      startAt,
    });
    const job = await savedWithOneInstallation(harness, "09:00");
    const [hop] = harness.messages;
    if (!hop) throw new Error("expected a checkpoint");
    harness.messages.splice(0); // dropped, or expired during a long hold

    // The first pass after the hop should have arrived re-arms the next one.
    harness.setClock(hop.visibleAt + 10 * MINUTE);
    await expect(harness.recover()).resolves.toMatchObject({
      lostReminderWakeups: { rearmed: 1 },
    });
    await harness.runUntil(job.intendedAt.getTime() + MINUTE);

    expect(harness.pushes).toEqual([
      { endpoint: "https://push.example.test/a", at: job.intendedAt.getTime() },
    ]);
  });

  it("abandons a delivered pointer once its job is finished, so the sweep meets it once", async () => {
    const harness = createHarness({ occursAt, startAt });
    await savedWithOneInstallation(harness, "09:00");
    await harness.runUntil(dueAt + MINUTE);
    expect(harness.pushes).toHaveLength(1);

    harness.setClock(dueAt + 10 * MINUTE);
    await harness.recover();
    harness.setClock(dueAt + 20 * MINUTE);
    await expect(harness.recover()).resolves.toMatchObject({
      lostReminderWakeups: { scanned: 0 },
    });
    await expect(
      harness.deliveries.listBackgroundJobDeliveries({ ownerUserId: OWNER }),
    ).resolves.toEqual([expect.objectContaining({ status: "abandoned" })]);
  });
});
