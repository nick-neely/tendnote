import type { ReminderPushSender } from "@tendnote/db/queries/reminders";
import webPush from "web-push";

type WebPushProvider = Pick<typeof webPush, "sendNotification" | "setVapidDetails">;

export function createWebPushSender(input: {
  provider?: WebPushProvider;
  publicKey: string;
  privateKey: string;
  subject: string;
}): ReminderPushSender {
  const provider = input.provider ?? webPush;
  provider.setVapidDetails(input.subject, input.publicKey, input.privateKey);
  return async ({ subscription, payload, ttlSeconds }) => {
    try {
      const response = await provider.sendNotification(subscription, JSON.stringify(payload), {
        TTL: ttlSeconds,
      });
      return { status: "accepted", providerId: response.headers?.location ?? null } as const;
    } catch (error) {
      const statusCode =
        typeof error === "object" && error && "statusCode" in error
          ? Number(error.statusCode)
          : null;
      if (statusCode === 404 || statusCode === 410) return { status: "terminal" } as const;
      throw new Error("Web Push provider temporarily unavailable.");
    }
  };
}

export function getWebPushSender() {
  const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error("Web Push VAPID configuration is incomplete.");
  }
  return createWebPushSender({ publicKey, privateKey, subject });
}
