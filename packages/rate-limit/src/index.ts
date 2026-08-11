export type CostCategoryBudget = { limit: number; windowSeconds: number };

export const RATE_LIMIT_COST_CATEGORIES = {
  "eve-ingress": { limit: 30, windowSeconds: 60 },
  "server-action": { limit: 60, windowSeconds: 60 },
  "llm-extraction": { limit: 20, windowSeconds: 60 },
  embedding: { limit: 60, windowSeconds: 60 },
  "provider-call": { limit: 60, windowSeconds: 60 },
  "push-delivery": { limit: 120, windowSeconds: 60 },
  /**
   * Household Invitation abuse budgets — five independent keys, one category
   * each, because a single shared limit is only ever as strict as its loosest
   * caller and gives no way to tune one axis without moving the others.
   *
   * They exist because seat capacity is not an abuse control: a
   * cancel-and-reinvite loop can harass a recipient forever without ever filling
   * the eighth seat. Every key is charged before an external send is set in
   * motion, all fail closed, and all raise the same message so a refusal never
   * discloses which one fired.
   *
   * The numbers are conservative starting points chosen against the eight-seat
   * household they protect, and they live here so production evidence can tune
   * one of them without a migration or a code change anywhere else.
   */
  // One person, one hour. Filling an eight-seat household takes seven sends, so
  // ten leaves room for a typo and a resend without leaving room for a spree.
  "household-invitation-inviter": { limit: 10, windowSeconds: 60 * 60 },
  // Co-owners share this one, so it is not simply the inviter budget again: it
  // bounds the household however many people are sending from inside it.
  "household-invitation-household": { limit: 15, windowSeconds: 60 * 60 },
  // The harassment budget. Deliberately the tightest and the longest window: one
  // mailbox should hear from Tendnote about one household a few times a day at
  // most, whoever is doing the asking.
  "household-invitation-recipient": { limit: 5, windowSeconds: 24 * 60 * 60 },
  // Keyed by the trusted request fingerprint rather than the account, so signing
  // up fresh accounts does not reset the budget.
  "household-invitation-source": { limit: 20, windowSeconds: 60 * 60 },
  // The provider-wide ceiling: whatever else passes, the deployment cannot burn
  // more than this much of its sending reputation in an hour. Sized under the
  // 100/day free tier the transactional-email research assumes.
  "household-invitation-delivery": { limit: 60, windowSeconds: 60 * 60 },
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
