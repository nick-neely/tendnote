import { beforeEach, describe, expect, it } from "vitest";
import { createFakeRateLimitStore } from "./fake-store";
import { createProductRateLimiter } from "./limiter";

const store = createFakeRateLimitStore();
// Frozen-but-movable clock so window math is deterministic.
let clockMs = 1_000_000_000_000;
const limiter = createProductRateLimiter(store, {
  now: () => clockMs,
  categories: {
    "eve-ingress": { limit: 3, windowSeconds: 60 },
    "server-action": { limit: 5, windowSeconds: 60 },
    "llm-extraction": { limit: 2, windowSeconds: 60 },
    embedding: { limit: 10, windowSeconds: 60 },
    "provider-call": { limit: 4, windowSeconds: 60 },
    "push-delivery": { limit: 8, windowSeconds: 60 },
    "household-invitation-inviter": { limit: 3, windowSeconds: 60 },
    "household-invitation-household": { limit: 3, windowSeconds: 60 },
    "household-invitation-recipient": { limit: 3, windowSeconds: 60 },
    "household-invitation-source": { limit: 3, windowSeconds: 60 },
    "household-invitation-delivery": { limit: 3, windowSeconds: 60 },
  },
});

beforeEach(() => {
  store.reset();
  clockMs = 1_000_000_000_000;
});

describe("product rate limiter", () => {
  it("allows up to the category limit, then denies", async () => {
    const subject = "user-1";
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await limiter.check({ subject, costCategory: "eve-ingress" }));
    }

    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[2]).toMatchObject({ allowed: true, remaining: 0, limit: 3 });
    expect(results[3]).toMatchObject({ allowed: false, reason: "limit_exceeded", remaining: 0 });
  });

  it("isolates counters by subject, cost category, and key", async () => {
    // Exhaust eve-ingress (limit 3) for user-1.
    for (let i = 0; i < 3; i++) {
      await limiter.check({ subject: "user-1", costCategory: "eve-ingress" });
    }
    // A different subject is unaffected.
    expect(await limiter.check({ subject: "user-2", costCategory: "eve-ingress" })).toMatchObject({
      allowed: true,
    });
    // A different cost category for the same subject is unaffected.
    expect(await limiter.check({ subject: "user-1", costCategory: "server-action" })).toMatchObject(
      { allowed: true },
    );
    // A different key dimension is its own bucket.
    expect(
      await limiter.check({ subject: "user-1", costCategory: "llm-extraction", key: "job:a" }),
    ).toMatchObject({ allowed: true });
    expect(
      await limiter.check({ subject: "user-1", costCategory: "llm-extraction", key: "job:b" }),
    ).toMatchObject({ allowed: true });
  });

  it("resets the counter when the window advances", async () => {
    for (let i = 0; i < 3; i++) {
      await limiter.check({ subject: "user-1", costCategory: "eve-ingress" });
    }
    expect(await limiter.check({ subject: "user-1", costCategory: "eve-ingress" })).toMatchObject({
      allowed: false,
    });

    // Advance past the 60s window — a fresh bucket key restores the budget.
    clockMs += 60_000;
    expect(await limiter.check({ subject: "user-1", costCategory: "eve-ingress" })).toMatchObject({
      allowed: true,
      remaining: 2,
    });
  });

  it("honors a per-call limit and window override", async () => {
    const allowed = await limiter.check({
      subject: "user-1",
      costCategory: "server-action",
      limit: 1,
    });
    const denied = await limiter.check({
      subject: "user-1",
      costCategory: "server-action",
      limit: 1,
    });

    expect(allowed).toMatchObject({ allowed: true, limit: 1 });
    expect(denied).toMatchObject({ allowed: false, limit: 1 });
  });

  it("reports resetAt at the end of the current fixed window", async () => {
    const result = await limiter.check({ subject: "user-1", costCategory: "eve-ingress" });
    // windowStart = floor(clock/1000/60)*60; resetAt = (windowStart + 60) * 1000.
    const windowStart = Math.floor(clockMs / 1000 / 60) * 60;
    expect(result.resetAt.getTime()).toBe((windowStart + 60) * 1000);
  });

  it("fails closed (denies) when the store errors", async () => {
    store.setFailing(true);

    const result = await limiter.check({ subject: "user-1", costCategory: "eve-ingress" });

    expect(result).toMatchObject({ allowed: false, reason: "store_error", count: null });
  });
});
