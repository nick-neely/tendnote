import { RATE_LIMIT_COST_CATEGORIES } from "./cost-categories";
import type {
  CostCategory,
  CostCategoryBudget,
  RateLimitRequest,
  RateLimitResult,
  RateLimitStore,
} from "./types";

export const DEFAULT_RATE_LIMIT_KEY_PREFIX = "tendnote:ratelimit:";

export type ProductRateLimiter = {
  check: (request: RateLimitRequest) => Promise<RateLimitResult>;
};

export type ProductRateLimiterOptions = {
  /**
   * Injectable clock (ms since epoch). A thunk rather than the repo's usual
   * `now?: Date` value because the limiter re-reads it on every check to compute
   * the current fixed-window bucket. Defaults to wall-clock time.
   */
  now?: () => number;
  /** Override the budget table (tests). Defaults to RATE_LIMIT_COST_CATEGORIES. */
  categories?: Record<CostCategory, CostCategoryBudget>;
  /** Redis key namespace, kept distinct from Better Auth's prefix. */
  keyPrefix?: string;
};

/**
 * Create the product rate limiter over a counter store. Uses a fixed-window
 * algorithm: the window bucket is derived from the clock, so all calls in the same
 * window share a counter that expires when the window ends.
 *
 * Fails conservatively: if the store errors (e.g. Redis is unreachable), the
 * request is DENIED with `reason: "store_error"`. Callers gating expensive or
 * abusive entry points get safe behavior by default; durable user mutations should
 * be applied so that a denial degrades rather than destroys committed state (#103).
 */
export function createProductRateLimiter(
  store: RateLimitStore,
  options: ProductRateLimiterOptions = {},
): ProductRateLimiter {
  const now = options.now ?? (() => Date.now());
  const categories = options.categories ?? RATE_LIMIT_COST_CATEGORIES;
  const keyPrefix = options.keyPrefix ?? DEFAULT_RATE_LIMIT_KEY_PREFIX;

  return {
    async check(request) {
      const budget = categories[request.costCategory];
      const limit = request.limit ?? budget.limit;
      const windowSeconds = request.windowSeconds ?? budget.windowSeconds;

      const windowStart = Math.floor(now() / 1000 / windowSeconds) * windowSeconds;
      const resetAt = new Date((windowStart + windowSeconds) * 1000);
      const key = [`${keyPrefix}${request.costCategory}`, request.key, request.subject, windowStart]
        .filter((part) => part !== undefined && part !== "")
        .join(":");

      let count: number;
      try {
        count = await store.increment({ key, ttlSeconds: windowSeconds });
      } catch {
        // Fail closed: an unavailable counter must not let expensive work through.
        return {
          allowed: false,
          limit,
          count: null,
          remaining: 0,
          resetAt,
          costCategory: request.costCategory,
          reason: "store_error",
        };
      }

      const allowed = count <= limit;

      return {
        allowed,
        limit,
        count,
        remaining: Math.max(0, limit - count),
        resetAt,
        costCategory: request.costCategory,
        ...(allowed ? {} : { reason: "limit_exceeded" as const }),
      };
    },
  };
}
