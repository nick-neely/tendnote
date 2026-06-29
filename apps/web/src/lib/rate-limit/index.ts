import { createProductRateLimiter, type ProductRateLimiter } from "./limiter";
import { createRedisRateLimitStore } from "./redis-store";

export { RATE_LIMIT_COST_CATEGORIES } from "./cost-categories";
export { createFakeRateLimitStore, type FakeRateLimitStore } from "./fake-store";
export {
  createProductRateLimiter,
  DEFAULT_RATE_LIMIT_KEY_PREFIX,
  type ProductRateLimiter,
  type ProductRateLimiterOptions,
} from "./limiter";
export { createRedisRateLimitStore, type RateLimitRedis } from "./redis-store";
export type {
  CostCategory,
  CostCategoryBudget,
  RateLimitRequest,
  RateLimitResult,
  RateLimitStore,
} from "./types";

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
