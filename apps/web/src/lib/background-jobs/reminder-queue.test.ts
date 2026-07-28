import {
  createInMemoryBackgroundJobDeliveryStore,
  publishBackgroundJobDelivery,
} from "@tendnote/db/queries/background-job-deliveries";
import { describe, expect, it, vi } from "vitest";
import { reminderOpenDeepLink } from "@/components/app-destinations";
import vercelConfig from "../../../vercel.json";
import { consumeReminderQueueMessage } from "./reminder-queue";

describe("Reminder queue", () => {
  it("registers a dedicated Vercel queue trigger", () => {
    expect(vercelConfig.functions["src/app/api/queue/reminder/route.ts"]).toEqual({
      experimentalTriggers: [{ type: "queue/v2beta", topic: "tendnote-reminder-push-v1" }],
    });
  });
  it("dispatches a due reminder through the shared durable delivery consumer", async () => {
    const deliveryStore = createInMemoryBackgroundJobDeliveryStore();
    const { delivery } = await deliveryStore.createBackgroundJobDelivery({
      ownerUserId: "owner-1",
      jobKind: "reminder_push",
      jobId: "11111111-1111-1111-1111-111111111111",
      nextAttemptAt: new Date("2026-08-14T14:00:00.000Z"),
    });
    const queue = { send: vi.fn(async () => ({ messageId: "message-1" })) };
    await publishBackgroundJobDelivery({
      store: deliveryStore,
      queue,
      ownerUserId: "owner-1",
      deliveryId: delivery.id,
      now: new Date("2026-08-14T14:00:00.000Z"),
    });
    const dispatch = vi.fn(async () => ({
      status: "accepted" as const,
      displayed: false as const,
    }));
    const sender = vi.fn(async () => ({ status: "accepted" as const }));

    const result = await consumeReminderQueueMessage({
      deliveryStore,
      payload: {
        deliveryId: delivery.id,
        jobKind: "reminder_push",
        jobId: delivery.jobId,
      },
      metadata: { topicName: "tendnote-reminder-push-v1" },
      now: new Date("2026-08-14T14:00:05.000Z"),
      sender,
      dispatch,
      getJob: vi.fn(async () => ({
        id: delivery.jobId,
        status: "pending" as const,
        nextAttemptAt: new Date("2026-08-14T14:00:00.000Z"),
      })) as never,
    });

    expect(result.status).toBe("processed");
    expect(dispatch).toHaveBeenCalledWith({
      deepLink: reminderOpenDeepLink,
      jobId: delivery.jobId,
      now: new Date("2026-08-14T14:00:05.000Z"),
      sender,
    });
  });
});
