import {
  registerBackgroundJobQueueTransport,
  registeredBackgroundJobQueueTransport,
} from "@tendnote/db/queries/background-job-deliveries";
import { afterEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn(async () => ({ messageId: "m-1" })));
vi.mock("@vercel/queue", () => ({ send }));

afterEach(() => {
  registerBackgroundJobQueueTransport(undefined);
  vi.unstubAllEnvs();
  vi.resetModules();
  send.mockClear();
});

describe("Eve queue transport registration", () => {
  it("registers Eve's signed adapter at startup without subscribing to events", async () => {
    const { default: hook } = await import("../agent/hooks/background-job-queue-transport");

    expect(hook.events).toEqual({});
    expect(registeredBackgroundJobQueueTransport()).toBeDefined();
  });

  it("passes a reminder's delay and retention through to the provider", async () => {
    vi.stubEnv("BACKGROUND_JOB_QUEUE_SECRET", "queue-secret");
    await import("../agent/hooks/background-job-queue-transport");

    await registeredBackgroundJobQueueTransport()?.send({
      topic: "tendnote-reminder-push-v1",
      payload: { deliveryId: "d-1", jobKind: "reminder_push", jobId: "j-1", revision: 2 },
      idempotencyKey: "reminder_push:j-1:tendnote-reminder-push-v1:d-1:r2",
      delaySeconds: 1_830,
      retentionSeconds: 88_230,
    });

    expect(send).toHaveBeenCalledWith(
      "tendnote-reminder-push-v1",
      expect.objectContaining({
        revision: 2,
        sig: expect.any(String),
        revisionSig: expect.any(String),
      }),
      expect.objectContaining({
        idempotencyKey: "reminder_push:j-1:tendnote-reminder-push-v1:d-1:r2",
        delaySeconds: 1_830,
        retentionSeconds: 88_230,
      }),
    );
  });
});
