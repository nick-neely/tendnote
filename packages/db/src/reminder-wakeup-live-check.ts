/**
 * Live verification of reminder wake-ups against the disposable local database.
 *
 * The scenario suites drive in-memory stores, so what only real Postgres can
 * answer lives here: that a revision bump is atomic under concurrent re-arms,
 * that a revision-fenced status write really is fenced, that an expired claim
 * lease is taken over by exactly one claimant, that publishing waits for the
 * surrounding transaction to commit (and never happens if it rolls back), and
 * that a reminder saved through the real stores is published at once, delayed
 * to its alert time, with no cron pass, and that the rollback reset returns a
 * delivery to the cron-only contract earlier code relies on (ADR 0267).
 *
 *   pnpm --filter @tendnote/db db:reminder-wakeups:check
 *
 * It seeds under the demo owner `pnpm db:seed` creates, uses a fake queue and a
 * fixed clock, and removes the rows it made on the way out.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { getDb, withDatabaseTransaction } from "./client";
import { check, DEMO_OWNER, reportLiveCheckResult, requireDemoAccounts } from "./live-check";
import {
  type BackgroundJobQueueSendAdapter,
  type BackgroundJobQueueSendInput,
  createDrizzleBackgroundJobDeliveryStore,
} from "./queries/background-job-deliveries";
import {
  armReminderDelivery,
  createDrizzleReminderStore,
  createReminderService,
  REMINDER_DELIVERY_LEASE_MS,
  recoverLostReminderWakeups,
  resetReminderDeliveriesToCronOnly,
} from "./queries/reminders";
import {
  backgroundJobDeliveries,
  reminderDeliveryJobs,
  reminderInstallations,
  reminderOccurrenceIntents,
  reminderOptInStates,
  reminderSchedules,
} from "./schema";

const NOW = new Date("2026-08-14T12:00:00.000Z");
const ALERT_AT = new Date("2026-08-14T14:00:00.000Z");
const followUpId = randomUUID();
const clientInstallationId = `live-check-${randomUUID()}`;
const scratchJobIds = [randomUUID(), randomUUID()];

function recordingQueue() {
  const sent: BackgroundJobQueueSendInput[] = [];
  const queue: BackgroundJobQueueSendAdapter = {
    async send(input) {
      sent.push(input);
      return { messageId: `m-${sent.length}` };
    },
  };
  return { sent, queue };
}

async function cleanup() {
  const db = getDb();
  const jobs = await db
    .select({ id: reminderDeliveryJobs.id })
    .from(reminderDeliveryJobs)
    .where(eq(reminderDeliveryJobs.recordId, followUpId));
  const jobIds = [...scratchJobIds, ...jobs.map((job) => job.id)];
  await db.delete(backgroundJobDeliveries).where(inArray(backgroundJobDeliveries.jobId, jobIds));
  await db.delete(reminderSchedules).where(eq(reminderSchedules.recordId, followUpId));
  await db
    .delete(reminderOccurrenceIntents)
    .where(eq(reminderOccurrenceIntents.recordId, followUpId));
  await db
    .delete(reminderInstallations)
    .where(eq(reminderInstallations.clientInstallationId, clientInstallationId));
  await db
    .delete(reminderOptInStates)
    .where(eq(reminderOptInStates.clientInstallationId, clientInstallationId));
}

async function checkDeliveryRevisions() {
  const deliveries = createDrizzleBackgroundJobDeliveryStore();
  const { delivery } = await deliveries.createBackgroundJobDelivery({
    ownerUserId: DEMO_OWNER,
    jobKind: "reminder_push",
    jobId: scratchJobIds[0] as string,
  });
  check("a new delivery starts unrevised", delivery.revision === 0, delivery);

  const revised = await Promise.all(
    Array.from({ length: 5 }, () =>
      deliveries.reviseBackgroundJobDelivery({
        ownerUserId: DEMO_OWNER,
        deliveryId: delivery.id,
        nextAttemptAt: NOW,
      }),
    ),
  );
  const revisions = revised.map((row) => row.revision).sort((a, b) => a - b);
  check(
    "concurrent re-arms each get their own revision",
    revisions.join(",") === "1,2,3,4,5",
    revisions,
  );

  const stale = await deliveries.markBackgroundJobDeliveryPublished({
    ownerUserId: DEMO_OWNER,
    deliveryId: delivery.id,
    publishedAt: NOW,
    revision: 3,
  });
  check(
    "a stale revision's publish leaves the current revision pending",
    stale.revision === 5 && stale.status === "pending" && stale.publishedAt === null,
    stale,
  );
  const current = await deliveries.markBackgroundJobDeliveryPublished({
    ownerUserId: DEMO_OWNER,
    deliveryId: delivery.id,
    publishedAt: NOW,
    revision: 5,
  });
  check("the current revision's publish is recorded", current.status === "published", current);
}

async function checkPublishWaitsForCommit() {
  const deliveries = createDrizzleBackgroundJobDeliveryStore();
  const { sent, queue } = recordingQueue();
  const jobId = scratchJobIds[1] as string;
  let sentInsideTransaction = -1;

  await withDatabaseTransaction(async () => {
    await armReminderDelivery({
      store: deliveries,
      queue,
      ownerUserId: DEMO_OWNER,
      jobId,
      deliverAt: ALERT_AT,
      now: NOW,
    });
    sentInsideTransaction = sent.length;
  });
  const [row] = await getDb()
    .select()
    .from(backgroundJobDeliveries)
    .where(eq(backgroundJobDeliveries.jobId, jobId));
  check("nothing is sent before the transaction commits", sentInsideTransaction === 0);
  check("the pointer is sent once it has", sent.length === 1, sent);
  check("and the committed row records it", row?.status === "published", row);

  await withDatabaseTransaction(async () => {
    await armReminderDelivery({
      store: deliveries,
      queue,
      ownerUserId: DEMO_OWNER,
      jobId,
      deliverAt: ALERT_AT,
      now: NOW,
    });
    throw new Error("roll back");
  }).catch(() => undefined);
  const [after] = await getDb()
    .select()
    .from(backgroundJobDeliveries)
    .where(eq(backgroundJobDeliveries.jobId, jobId));
  check("a rolled-back re-arm sends nothing", sent.length === 1, sent);
  check("and leaves the committed revision as it was", after?.revision === row?.revision, after);
}

// fallow-ignore-next-line complexity -- One end-to-end path through the real stores reads best as one sequence of checks.
async function checkReminderPublishedOnSave() {
  const reminders = createDrizzleReminderStore();
  const deliveries = createDrizzleBackgroundJobDeliveryStore();
  const { sent, queue } = recordingQueue();
  const service = createReminderService({
    store: reminders,
    loadReminderRecord: async () => ({
      id: followUpId,
      kind: "follow_up",
      ownerUserId: DEMO_OWNER,
      title: "Live check follow-up",
      status: "open",
      occursAt: new Date("2026-08-14T00:00:00.000Z"),
      timeSemantics: "date_only",
      recurrence: null,
      sensitivity: "normal",
      scope: "private",
      personId: null,
    }),
    checkPushEndpoint: async () => ({
      status: "allowed",
      host: "push.example.test",
      addresses: [],
    }),
    scheduleDelivery: async (values) => {
      await armReminderDelivery({
        store: deliveries,
        queue,
        ownerUserId: values.ownerUserId,
        jobId: values.jobId,
        deliverAt: values.nextAttemptAt,
        now: NOW,
      });
    },
  });

  await service.saveReminder({
    ownerUserId: DEMO_OWNER,
    recordKind: "follow_up",
    recordId: followUpId,
    clientInstallationId,
    timeZone: "America/Chicago",
    schedule: { kind: "exact", localTime: "09:00" },
    now: NOW,
  });
  await service.registerReminderInstallation({
    ownerUserId: DEMO_OWNER,
    clientInstallationId,
    subscription: {
      endpoint: "https://push.example.test/live-check",
      expirationTime: null,
      keys: { p256dh: "p256dh", auth: "auth" },
    },
    now: NOW,
  });
  const [job] = await getDb()
    .select()
    .from(reminderDeliveryJobs)
    .where(eq(reminderDeliveryJobs.recordId, followUpId));
  const [pointer] = sent;
  check("a saved reminder is published without a cron pass", sent.length === 1, sent);
  check(
    "delayed to its alert time",
    pointer?.delaySeconds === (ALERT_AT.getTime() - NOW.getTime()) / 1000,
    pointer,
  );
  check(
    "as a revisioned pointer for that job",
    pointer?.payload.jobId === job?.id && pointer?.payload.revision === 1,
    pointer,
  );
  if (!job) return;

  const early = await reminders.claimDeliveryJob({ jobId: job.id, now: NOW });
  check("the job cannot be claimed before it is due", early === null, early);
  const claimed = await reminders.claimDeliveryJob({ jobId: job.id, now: ALERT_AT });
  check("it can be claimed once due", claimed?.status === "running", claimed);

  const takeoverAt = new Date(ALERT_AT.getTime() + REMINDER_DELIVERY_LEASE_MS + 1_000);
  const withinLease = await reminders.claimDeliveryJob({
    jobId: job.id,
    now: new Date(ALERT_AT.getTime() + 60_000),
  });
  check("a live claim is not taken over", withinLease === null, withinLease);
  const takeovers = await Promise.all([
    reminders.claimDeliveryJob({ jobId: job.id, now: takeoverAt }),
    reminders.claimDeliveryJob({ jobId: job.id, now: takeoverAt }),
  ]);
  check(
    "an expired claim is taken over by exactly one claimant",
    takeovers.filter(Boolean).length === 1,
    takeovers,
  );

  // The takeover itself crashed too; recovery finds the job overdue and re-arms it.
  const recoveryAt = new Date(takeoverAt.getTime() + REMINDER_DELIVERY_LEASE_MS + 1_000);
  const recovered = await recoverLostReminderWakeups({
    reminderStore: {
      ...reminders,
      listOverdueDeliveryJobs: async (input) =>
        (await reminders.listOverdueDeliveryJobs({ ...input, limit: 1_000 })).filter(
          (candidate) => candidate.id === job.id,
        ),
    },
    deliveryStore: deliveries,
    queue,
    now: recoveryAt,
    limit: 25,
  });
  check("recovery re-arms the stranded job", recovered.rearmed === 1, recovered);
  check(
    "with an immediate, newer pointer",
    sent.at(-1)?.delaySeconds === 0 && sent.at(-1)?.payload.revision === 2,
    sent.at(-1),
  );

  // Rolling back to cron-only code: the row must look as that code expects.
  await reminders.updateDeliveryJob({
    jobId: job.id,
    now: recoveryAt,
    status: "failed",
    outcome: "transient_failure",
    nextAttemptAt: new Date(recoveryAt.getTime() + 5 * 60_000),
  });
  await resetReminderDeliveriesToCronOnly();
  const [reset] = await getDb()
    .select()
    .from(backgroundJobDeliveries)
    .where(eq(backgroundJobDeliveries.jobId, job.id));
  check(
    "rollback resets the delivery to a pending row due with its job, keeping its revision",
    reset?.status === "pending" &&
      reset.revision === 2 &&
      reset.nextAttemptAt.getTime() === recoveryAt.getTime() + 5 * 60_000,
    reset,
  );
}

async function main() {
  await requireDemoAccounts();
  await cleanup();
  try {
    console.log("delivery revisions");
    await checkDeliveryRevisions();
    console.log("publish after commit");
    await checkPublishWaitsForCommit();
    console.log("reminder published on save");
    await checkReminderPublishedOnSave();
  } finally {
    await cleanup();
  }
  reportLiveCheckResult();
}

void main();
