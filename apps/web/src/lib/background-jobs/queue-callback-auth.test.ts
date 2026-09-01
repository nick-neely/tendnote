import {
  attachBackgroundJobQueueSignature,
  type BackgroundJobQueuePayload,
  verifyBackgroundJobQueueSignature,
} from "@tendnote/db/queries/background-job-deliveries";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `@vercel/queue` does not authenticate inbound callbacks. We mock it so the test can
// drive the exact handler `createBackgroundJobQueueCallback` wraps: the returned fn is
// called with the parsed message and metadata, standing in for the platform delivery.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("@vercel/queue", () => ({
  handleCallback:
    (handler: (message: unknown, metadata: unknown) => Promise<void>) =>
    async (input: { message: unknown; metadata: unknown }) => {
      await handler(input.message, input.metadata);
      return new Response(null, { status: 200 });
    },
  send: sendMock,
}));
vi.mock("@/lib/rate-limit", () => ({
  getProductRateLimiter: () => ({ check: vi.fn().mockResolvedValue({ allowed: true }) }),
}));

import {
  BACKGROUND_JOB_QUEUE_CONFIG,
  createBackgroundJobQueueCallback,
  createVercelBackgroundJobQueueAdapter,
} from "./queue-runtime";

const SECRET = "queue-callback-secret";
const metadata = {
  topicName: BACKGROUND_JOB_QUEUE_CONFIG.extraction.topic,
  messageId: "message-1",
  deliveryCount: 1,
  consumerGroup: BACKGROUND_JOB_QUEUE_CONFIG.extraction.consumerGroup,
};
const basePayload: BackgroundJobQueuePayload = {
  deliveryId: "delivery-1",
  jobKind: "extraction",
  jobId: "job-1",
};

// The mocked handleCallback returns a fn that accepts { message, metadata }.
type DrivableCallback = (input: { message: unknown; metadata: unknown }) => Promise<Response>;

function makeCallback(consume = vi.fn().mockResolvedValue({ status: "processed" })) {
  const callback = createBackgroundJobQueueCallback({
    config: BACKGROUND_JOB_QUEUE_CONFIG.extraction,
    consume,
    deferredMessage: (reason) => `Extraction delivery deferred: ${reason}`,
  }) as unknown as DrivableCallback;
  return { callback, consume };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BACKGROUND_JOB_QUEUE_SECRET", SECRET);
  vi.stubEnv("BETTER_AUTH_SECRET", "");
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("background job queue callback authentication", () => {
  it("runs the consumer for a correctly signed message", async () => {
    const { callback, consume } = makeCallback();

    const response = await callback({
      message: attachBackgroundJobQueueSignature(basePayload, SECRET),
      metadata,
    });

    expect(response.status).toBe(200);
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it("rejects an unsigned message before any consumer work", async () => {
    const { callback, consume } = makeCallback();

    await expect(callback({ message: basePayload, metadata })).rejects.toThrow(/signature/i);
    expect(consume).not.toHaveBeenCalled();
  });

  it("rejects a forged signature before any consumer work", async () => {
    const { callback, consume } = makeCallback();

    await expect(
      callback({ message: { ...basePayload, sig: "00".repeat(32) }, metadata }),
    ).rejects.toThrow(/signature/i);
    expect(consume).not.toHaveBeenCalled();
  });

  it("rejects a message whose fields were tampered after signing", async () => {
    const { callback, consume } = makeCallback();
    const signed = attachBackgroundJobQueueSignature(basePayload, SECRET);

    await expect(
      callback({ message: { ...signed, jobId: "job-swapped" }, metadata }),
    ).rejects.toThrow(/signature/i);
    expect(consume).not.toHaveBeenCalled();
  });

  it("fails closed in production/preview when no secret is configured", async () => {
    vi.stubEnv("BACKGROUND_JOB_QUEUE_SECRET", "");
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    const { callback, consume } = makeCallback();

    await expect(callback({ message: basePayload, metadata })).rejects.toThrow(/not configured/i);
    expect(consume).not.toHaveBeenCalled();
  });

  it("allows unsigned in-process delivery in local development without a secret", async () => {
    vi.stubEnv("BACKGROUND_JOB_QUEUE_SECRET", "");
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");
    const { callback, consume } = makeCallback();

    const response = await callback({ message: basePayload, metadata });

    expect(response.status).toBe(200);
    expect(consume).toHaveBeenCalledTimes(1);
  });
});

describe("background job queue producer signing", () => {
  it("publishes a payload the consumer can verify with the shared secret", async () => {
    sendMock.mockResolvedValue({ messageId: "message-1" });
    const adapter = createVercelBackgroundJobQueueAdapter();

    await adapter.send({
      topic: BACKGROUND_JOB_QUEUE_CONFIG.extraction.topic,
      payload: basePayload,
      idempotencyKey: "idem-1",
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const sentPayload = sendMock.mock.calls[0]?.[1];
    expect(sentPayload).toMatchObject(basePayload);
    expect(verifyBackgroundJobQueueSignature(sentPayload, SECRET)).toBe(true);
  });
});
