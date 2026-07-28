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
  type ReminderPushSender,
} from "@tendnote/db/queries/reminders";
import { reminderOpenDeepLink } from "@/components/app-destinations";
import type { ProductRateLimiter } from "@/lib/rate-limit";
import { type BackgroundJobQueueLogger, consumeBackgroundJobQueueMessage } from "./queue-runtime";
import { getWebPushSender } from "./web-push";

type ReminderJob = Awaited<
  ReturnType<ReturnType<typeof createDrizzleReminderStore>["getDeliveryJob"]>
>;

function createReminderQueueProcessor(input: {
  now: Date;
  getJob: (jobId: string) => Promise<ReminderJob>;
  dispatch: (input: {
    jobId: string;
    now: Date;
    sender: ReminderPushSender;
    deepLink: typeof reminderOpenDeepLink;
  }) => Promise<unknown>;
  sender: ReminderPushSender;
}): BackgroundJobQueueProcessor {
  return {
    jobKind: "reminder_push",
    async claimJob({ jobId }) {
      const job = await input.getJob(jobId);
      if (!job) return { status: "not_found", reason: "Reminder delivery job not found." };
      if (job.status === "completed" || job.status === "skipped") {
        return { status: "terminal", reason: `Reminder delivery job is ${job.status}.` };
      }
      if (job.nextAttemptAt.getTime() > input.now.getTime()) {
        return { status: "not_claimable", reason: "Reminder delivery job is not due." };
      }
      if (job.status === "pending" || job.status === "failed") return { status: "ready" };
      return { status: "not_claimable", reason: `Reminder delivery job is ${job.status}.` };
    },
    async processJob({ jobId }) {
      await input.dispatch({
        jobId,
        now: input.now,
        sender: input.sender,
        deepLink: reminderOpenDeepLink,
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
  getJob?: ReturnType<typeof createDrizzleReminderStore>["getDeliveryJob"];
  dispatch?: typeof dispatchReminder;
}) {
  const now = input.now ?? new Date();
  const reminderStore = createDrizzleReminderStore();
  return consumeBackgroundJobQueueMessage({
    store: input.deliveryStore ?? createDrizzleBackgroundJobDeliveryStore(),
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
      }),
    ],
  });
}
