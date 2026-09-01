import { describe, expect, it, vi } from "vitest";
import { createWebPushSender } from "./web-push";

/** Stands in for the system resolver so the adapter's own rules stay under test. */
const resolvesTo = (address: string, family: 4 | 6 = 4) => vi.fn(async () => [{ address, family }]);

const payload = {
  title: "Tendnote reminder",
  body: "Open Tendnote to see what needs your attention.",
  tag: "reminder-1",
  data: {
    url: "/actions#action-1",
    recordKind: "general_action" as const,
    recordId: "action-1",
  },
};

const keys = { p256dh: "p256dh", auth: "auth" };

describe("Web Push adapter", () => {
  it("records provider acceptance without claiming display", async () => {
    const setVapidDetails = vi.fn();
    const sendNotification = vi.fn(async () => ({ headers: { location: "provider-1" } }));
    const sender = createWebPushSender({
      provider: { setVapidDetails, sendNotification } as never,
      publicKey: "public",
      privateKey: "private",
      subject: "mailto:owner@example.test",
      lookup: resolvesTo("93.184.216.34"),
    });
    const result = await sender({
      subscription: {
        endpoint: "https://push.example.test/endpoint",
        expirationTime: null,
        keys,
      },
      payload,
      ttlSeconds: 3_600,
    });
    expect(setVapidDetails).toHaveBeenCalledOnce();
    expect(sendNotification).toHaveBeenCalledOnce();
    expect(result).toEqual({ status: "accepted", providerId: "provider-1" });
  });

  it("bounds the outbound request and pins it to the verified address", async () => {
    type SendOptions = { timeout?: number; agent?: { options?: { lookup?: unknown } } };
    let options: SendOptions | undefined;
    const sendNotification = vi.fn(
      async (_subscription: unknown, _payload: unknown, sendOptions: unknown) => {
        options = sendOptions as SendOptions;
        return { headers: {} };
      },
    );
    const sender = createWebPushSender({
      provider: { setVapidDetails: vi.fn(), sendNotification } as never,
      publicKey: "public",
      privateKey: "private",
      subject: "mailto:owner@example.test",
      lookup: resolvesTo("93.184.216.34"),
    });
    await sender({
      subscription: { endpoint: "https://push.example.test/endpoint", expirationTime: null, keys },
      payload,
      ttlSeconds: 60,
    });
    expect(options?.timeout).toBe(10_000);
    const lookup = options?.agent?.options?.lookup as (
      hostname: string,
      options: { all?: boolean },
      callback: (error: Error | null, address: unknown, family?: number) => void,
    ) => void;
    const pinned = vi.fn();
    lookup("push.example.test", { all: true }, pinned);
    expect(pinned).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
    const rebound = vi.fn();
    lookup("metadata.google.internal", { all: true }, rebound);
    expect(rebound.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it("refuses to send to an endpoint that resolves inside the network", async () => {
    const sendNotification = vi.fn(async () => ({ headers: {} }));
    const sender = createWebPushSender({
      provider: { setVapidDetails: vi.fn(), sendNotification } as never,
      publicKey: "public",
      privateKey: "private",
      subject: "mailto:owner@example.test",
      lookup: resolvesTo("169.254.169.254"),
    });
    await expect(
      sender({
        subscription: {
          endpoint: "https://push.attacker.example/endpoint",
          expirationTime: null,
          keys,
        },
        payload,
        ttlSeconds: 60,
      }),
    ).resolves.toEqual({ status: "terminal" });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("refuses a stored endpoint whose scheme or port no longer passes", async () => {
    const sendNotification = vi.fn(async () => ({ headers: {} }));
    const sender = createWebPushSender({
      provider: { setVapidDetails: vi.fn(), sendNotification } as never,
      publicKey: "public",
      privateKey: "private",
      subject: "mailto:owner@example.test",
      lookup: resolvesTo("93.184.216.34"),
    });
    await expect(
      sender({
        subscription: {
          endpoint: "http://push.example.test:8080/endpoint",
          expirationTime: null,
          keys,
        },
        payload,
        ttlSeconds: 60,
      }),
    ).resolves.toEqual({ status: "terminal" });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("treats an unresolvable endpoint as temporary rather than terminal", async () => {
    const sender = createWebPushSender({
      provider: { setVapidDetails: vi.fn(), sendNotification: vi.fn() } as never,
      publicKey: "public",
      privateKey: "private",
      subject: "mailto:owner@example.test",
      lookup: vi.fn(async () => {
        throw new Error("ENOTFOUND");
      }),
    });
    await expect(
      sender({
        subscription: {
          endpoint: "https://push.example.test/endpoint",
          expirationTime: null,
          keys,
        },
        payload,
        ttlSeconds: 60,
      }),
    ).rejects.toThrow("Web Push provider temporarily unavailable.");
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
      lookup: resolvesTo("93.184.216.34"),
    });
    await expect(
      sender({
        subscription: { endpoint: "https://push.example.test/gone", expirationTime: null, keys },
        payload,
        ttlSeconds: 60,
      }),
    ).resolves.toEqual({ status: "terminal" });
  });
});
