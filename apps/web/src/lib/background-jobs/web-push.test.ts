import { describe, expect, it, vi } from "vitest";
import { createWebPushSender } from "./web-push";

describe("Web Push adapter", () => {
  it("records provider acceptance without claiming display", async () => {
    const setVapidDetails = vi.fn();
    const sendNotification = vi.fn(async () => ({ headers: { location: "provider-1" } }));
    const sender = createWebPushSender({
      provider: { setVapidDetails, sendNotification } as never,
      publicKey: "public",
      privateKey: "private",
      subject: "mailto:owner@example.test",
    });
    const result = await sender({
      subscription: {
        endpoint: "https://push.example.test/endpoint",
        expirationTime: null,
        keys: { p256dh: "p256dh", auth: "auth" },
      },
      payload: {
        title: "Tendnote reminder",
        body: "Open Tendnote to see what needs your attention.",
        tag: "reminder-1",
        data: { url: "/actions#action-1", recordKind: "general_action", recordId: "action-1" },
      },
      ttlSeconds: 3_600,
    });
    expect(setVapidDetails).toHaveBeenCalledOnce();
    expect(sendNotification).toHaveBeenCalledOnce();
    expect(result).toEqual({ status: "accepted", providerId: "provider-1" });
  });

  it("maps only gone endpoints to a terminal installation", async () => {
    const sender = createWebPushSender({
      provider: {
        setVapidDetails: vi.fn(),
        sendNotification: vi.fn(async () => {
          throw { statusCode: 410 };
        }),
      } as never,
      publicKey: "public",
      privateKey: "private",
      subject: "mailto:owner@example.test",
    });
    await expect(
      sender({
        subscription: {
          endpoint: "https://push.example.test/gone",
          expirationTime: null,
          keys: { p256dh: "p256dh", auth: "auth" },
        },
        payload: {
          title: "Tendnote reminder",
          body: "Open Tendnote to see what needs your attention.",
          tag: "reminder-1",
          data: { url: "/actions#action-1", recordKind: "general_action", recordId: "action-1" },
        },
        ttlSeconds: 60,
      }),
    ).resolves.toEqual({ status: "terminal" });
  });
});
