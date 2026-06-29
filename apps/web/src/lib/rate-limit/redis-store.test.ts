import { describe, expect, it, vi } from "vitest";
import { createRedisRateLimitStore, type RateLimitRedis } from "./redis-store";

function fakeRedis(counts: Record<string, number>): RateLimitRedis & {
  incr: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
} {
  const incr = vi.fn(async (key: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
    return counts[key];
  });
  const expire = vi.fn(async () => 1);
  return { incr, expire };
}

describe("redis rate-limit store", () => {
  it("increments via INCR and sets the TTL only on the first hit of a window", async () => {
    const client = fakeRedis({});
    const store = createRedisRateLimitStore(() => client);

    expect(await store.increment({ key: "k", ttlSeconds: 60 })).toBe(1);
    expect(await store.increment({ key: "k", ttlSeconds: 60 })).toBe(2);

    expect(client.incr).toHaveBeenCalledTimes(2);
    // EXPIRE is set once, when the counter is created (count === 1).
    expect(client.expire).toHaveBeenCalledTimes(1);
    expect(client.expire).toHaveBeenCalledWith("k", 60);
  });
});
