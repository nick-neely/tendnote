import { getRedis } from "@/lib/cache/redis";
import type { RateLimitStore } from "./types";

/** Minimal slice of the Redis client this store needs (eases testing). */
export type RateLimitRedis = {
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<unknown>;
};

/**
 * Redis-backed fixed-window counter. Reuses the existing Tendnote Redis connection
 * (ADR-0070) rather than adding a second client. The first increment in a window
 * sets the TTL so the counter self-expires when the window ends.
 */
export function createRedisRateLimitStore(
  getClient: () => RateLimitRedis = getRedis,
): RateLimitStore {
  return {
    async increment({ key, ttlSeconds }) {
      const client = getClient();
      const count = await client.incr(key);

      if (count === 1) {
        await client.expire(key, ttlSeconds);
      }

      return count;
    },
  };
}
