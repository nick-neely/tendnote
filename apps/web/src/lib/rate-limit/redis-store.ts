import {
  createRedisRateLimitStore as createSharedRedisRateLimitStore,
  type RateLimitRedis,
  type RateLimitStore,
} from "@tendnote/rate-limit";
import { getRedis } from "@/lib/cache/redis";

export type { RateLimitRedis } from "@tendnote/rate-limit";

/**
 * Redis-backed fixed-window counter. Reuses the existing Tendnote Redis connection
 * (ADR-0070) rather than adding a second client. The first increment in a window
 * sets the TTL so the counter self-expires when the window ends.
 */
export function createRedisRateLimitStore(
  getClient: () => RateLimitRedis = getRedis,
): RateLimitStore {
  return createSharedRedisRateLimitStore(getClient);
}
