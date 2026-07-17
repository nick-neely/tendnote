import { createProductRateLimiter, type ProductRateLimiter } from "./limiter";
import { createRedisRateLimitStore } from "./redis-store";

export type { ProductRateLimiter } from "./limiter";
export type { CostCategory } from "./types";

let limiter: ProductRateLimiter | undefined;

/**
 * The default product rate limiter, backed by the existing Redis connection. Lazy
 * so tests that import sibling helpers don't construct a Redis-backed limiter.
 */
export function getProductRateLimiter(): ProductRateLimiter {
  if (!limiter) {
    limiter = createProductRateLimiter(createRedisRateLimitStore());
  }

  return limiter;
}
