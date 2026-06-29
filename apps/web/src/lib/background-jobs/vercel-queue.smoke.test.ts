import { PollingQueueClient } from "@vercel/queue";
import { describe, expect, it } from "vitest";

const smokeEnabled = process.env.TENDNOTE_VERCEL_QUEUE_SMOKE === "1";
const smokeConfig = {
  token: process.env.TENDNOTE_VERCEL_QUEUE_SMOKE_TOKEN,
  region: process.env.TENDNOTE_VERCEL_QUEUE_SMOKE_REGION,
  topic: process.env.TENDNOTE_VERCEL_QUEUE_SMOKE_TOPIC,
};
const missingSmokeConfig = Object.entries(smokeConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

describe.skipIf(!smokeEnabled)("live Vercel Queue smoke", () => {
  it("has explicit smoke credentials", () => {
    expect(missingSmokeConfig).toEqual([]);
  });

  it.skipIf(missingSmokeConfig.length > 0)(
    "publishes and consumes a synthetic queue message",
    async () => {
      const client = new PollingQueueClient({
        token: smokeConfig.token,
        region: smokeConfig.region ?? "iad1",
        deploymentId: null,
      });
      const payload = {
        deliveryId: `smoke-delivery-${crypto.randomUUID()}`,
        jobKind: "extraction",
        jobId: `smoke-job-${crypto.randomUUID()}`,
      };
      const consumerGroup = `tendnote-smoke-${crypto.randomUUID()}`;

      await client.send(smokeConfig.topic ?? "tendnote-smoke", payload, {
        idempotencyKey: `tendnote-smoke:${payload.deliveryId}`,
        retentionSeconds: 60,
      });

      const received: unknown[] = [];
      const result = await client.receive(
        smokeConfig.topic ?? "tendnote-smoke",
        consumerGroup,
        async (message) => {
          received.push(message);
        },
        { limit: 1, visibilityTimeoutSeconds: 30 },
      );

      expect(result.ok).toBe(true);
      expect(received).toEqual([payload]);
    },
    30_000,
  );
});
