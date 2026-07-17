export type CostCategoryBudget = { limit: number; windowSeconds: number };

export const RATE_LIMIT_COST_CATEGORIES = {
  "eve-ingress": { limit: 30, windowSeconds: 60 },
  "server-action": { limit: 60, windowSeconds: 60 },
  "llm-extraction": { limit: 20, windowSeconds: 60 },
  embedding: { limit: 60, windowSeconds: 60 },
  "provider-call": { limit: 60, windowSeconds: 60 },
} as const satisfies Record<string, CostCategoryBudget>;

export type CostCategory = keyof typeof RATE_LIMIT_COST_CATEGORIES;
export type RateLimitRequest = {
  subject: string;
  costCategory: CostCategory;
  key?: string;
  limit?: number;
  windowSeconds?: number;
};
export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  count: number | null;
  remaining: number;
  resetAt: Date;
  costCategory: CostCategory;
  reason?: "limit_exceeded" | "store_error";
};
export type RateLimitStore = {
  increment: (input: { key: string; ttlSeconds: number }) => Promise<number>;
};
export type ProductRateLimiter = {
  check: (request: RateLimitRequest) => Promise<RateLimitResult>;
};
export type ProductRateLimiterOptions = {
  now?: () => number;
  categories?: Record<CostCategory, CostCategoryBudget>;
  keyPrefix?: string;
};

export const DEFAULT_RATE_LIMIT_KEY_PREFIX = "tendnote:ratelimit:";

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

export type FakeRateLimitStore = RateLimitStore & {
  counts: Map<string, number>;
  setFailing: (failing: boolean) => void;
  reset: () => void;
};

export function createFakeRateLimitStore(): FakeRateLimitStore {
  const counts = new Map<string, number>();
  let failing = false;

  return {
    counts,
    setFailing(next) {
      failing = next;
    },
    reset() {
      counts.clear();
      failing = false;
    },
    async increment({ key }) {
      if (failing) throw new Error("fake rate-limit store failure");
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
  };
}

export type RateLimitRedis = {
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<unknown>;
};

export function createRedisRateLimitStore(getClient: () => RateLimitRedis): RateLimitStore {
  return {
    async increment({ key, ttlSeconds }) {
      const client = getClient();
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, ttlSeconds);
      return count;
    },
  };
}
