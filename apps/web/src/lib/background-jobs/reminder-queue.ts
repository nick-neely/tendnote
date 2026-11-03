import {
  type BackgroundJobDeliveryStore,
  createDrizzleBackgroundJobDeliveryStore,
} from "@tendnote/db/queries/background-job-deliveries";
import type {
  BackgroundJobQueueConsumerMetadata,
  BackgroundJobQueueProcessor,
} from "@tendnote/db/queries/background-jobs";
import {
  createDrizzleReminderStore,
  dispatchReminder,
  isReminderDeliveryJobClaimable,
  type ReminderPushSender,
  rearmReminderDeliveryJob,
  reminderDeliveryPublishesAhead,
} from "@tendnote/db/queries/reminders";
import { reminderOpenDeepLink } from "@/components/app-destinations";
import type { ProductRateLimiter } from "@/lib/rate-limit";
import {
  type BackgroundJobQueueLogger,
  type BackgroundJobQueueSendAdapter,
  consumeBackgroundJobQueueMessage,
} from "./queue-runtime";
import { createVercelBackgroundJobQueueAdapter } from "./vercel-queue-transport";
import { getWebPushSender } from "./web-push";

type ReminderJob = Awaited<
  ReturnType<ReturnType<typeof createDrizzleReminderStore>["getDeliveryJob"]>
>;

function wholeSecondsBetween(later: Date, earlier: Date) {
  return Math.round((later.getTime() - earlier.getTime()) / 1000);
}

function createReminderQueueProcessor(input: {
  now: Date;
  getJob: (jobId: string) => Promise<ReminderJob>;
  dispatch: typeof dispatchReminder;
  sender: ReminderPushSender;
  rearm: (jobId: string, observedRevision: number | undefined) => Promise<unknown>;
  logger?: BackgroundJobQueueLogger;
}): BackgroundJobQueueProcessor {
  let claimed: NonNullable<ReminderJob> | null = null;
  return {
    jobKind: "reminder_push",
    async claimJob({ jobId, deliveryRevision }) {
      const job = await input.getJob(jobId);
      if (!job) return { status: "not_found", reason: "Reminder delivery job not found." };
      if (job.status === "completed" || job.status === "skipped") {
        return { status: "terminal", reason: `Reminder delivery job is ${job.status}.` };
      }
      if (isReminderDeliveryJobClaimable(job, input.now)) {
        claimed = job;
        return { status: "ready" };
      }
      if (job.status === "pending" || job.status === "failed") {
        // Woken before the job is due: a checkpoint short of a far-future
        // alert, a retry not yet due, or a callback that arrived early. This
        // may be the job's only wake-up, so arm the next one from current
        // state instead of dropping it.
        // Fenced on the revision this message was validated against, read
        // before the job: an edit landing meanwhile re-arms from fresher state.
        await input.rearm(jobId, deliveryRevision);
        input.logger?.info?.("reminder_delivery.checkpoint", {
          secondsUntilDue: wholeSecondsBetween(job.nextAttemptAt, input.now),
        });
        return { status: "retry_pending", reason: "Reminder delivery job is not due yet." };
      }
      return { status: "not_claimable", reason: `Reminder delivery job is ${job.status}.` };
    },
    async processJob({ jobId, metadata }) {
      const outcome = await input.dispatch({
        jobId,
        now: input.now,
        sender: input.sender,
        deepLink: reminderOpenDeepLink,
      });
      // Reliability evidence without content or identifiers: how late the
      // pointer woke us (queue lag) and, for an accepted send, how long after
      // the alert time the push provider accepted it. Provider acceptance is
      // not display on the device.
      input.logger?.info?.("reminder_delivery.dispatched", {
        status: outcome.status,
        ...("reason" in outcome ? { reason: outcome.reason } : {}),
        ...(claimed
          ? {
              queueLagSeconds: wholeSecondsBetween(input.now, claimed.nextAttemptAt),
              attempts: claimed.attempts,
              ...(outcome.status === "accepted"
                ? { alertToAcceptanceSeconds: wholeSecondsBetween(new Date(), claimed.intendedAt) }
                : {}),
            }
          : {}),
        ...(metadata?.deliveryCount ? { deliveryCount: metadata.deliveryCount } : {}),
      });
    },
  };
}

export async function consumeReminderQueueMessage(input: {
  payload: unknown;
  metadata?: BackgroundJobQueueConsumerMetadata;
  deliveryStore?: BackgroundJobDeliveryStore;
  logger?: BackgroundJobQueueLogger;
  rateLimiter?: ProductRateLimiter;
  now?: Date;
  sender?: ReminderPushSender;
  reminderStore?: Pick<ReturnType<typeof createDrizzleReminderStore>, "getDeliveryJob">;
  getJob?: ReturnType<typeof createDrizzleReminderStore>["getDeliveryJob"];
  dispatch?: typeof dispatchReminder;
  queue?: BackgroundJobQueueSendAdapter;
}) {
  const now = input.now ?? new Date();
  const reminderStore = input.reminderStore ?? createDrizzleReminderStore();
  const deliveryStore = input.deliveryStore ?? createDrizzleBackgroundJobDeliveryStore();
  const queue = input.queue ?? createVercelBackgroundJobQueueAdapter();
  return consumeBackgroundJobQueueMessage({
    store: deliveryStore,
    payload: input.payload,
    metadata: input.metadata,
    logger: input.logger,
    rateLimiter: input.rateLimiter,
    processors: [
      createReminderQueueProcessor({
        now,
        getJob: input.getJob ?? reminderStore.getDeliveryJob,
        dispatch: input.dispatch ?? dispatchReminder,
        sender: input.sender ?? getWebPushSender(),
        rearm: (jobId, observedRevision) =>
          rearmReminderDeliveryJob({
            reminderStore,
            deliveryStore,
            queue,
            jobId,
            observedRevision,
            now,
            publishAhead: reminderDeliveryPublishesAhead(process.env),
            logger: input.logger,
          }),
        logger: input.logger,
      }),
    ],
  });
}
