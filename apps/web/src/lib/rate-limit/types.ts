/**
 * Tendnote product rate limiter (Phase 2B, ADR-0070).
 *
 * This limiter is SEPARATE from Better Auth's auth/session rate limiting. Better
 * Auth keeps owning signup, sign-in, password reset, session, and auth-abuse
 * limits; this limiter owns admitted product work — Eve ingress, expensive server
 * actions, queue consumers (via cost category), and future provider API calls.
 *
 * The algorithm is a fixed-window counter: the limiter computes a window-bucketed
 * key and asks the store to increment it; the store is a dumb counter seam so it
 * can be backed by the existing Redis connection in production and a deterministic
 * fake in tests.
 */

import type { RATE_LIMIT_COST_CATEGORIES } from "./cost-categories";

export type CostCategory = keyof typeof RATE_LIMIT_COST_CATEGORIES;

/** Per-category budget: how many requests are allowed per fixed window. */
export type CostCategoryBudget = {
  limit: number;
  windowSeconds: number;
};

export type RateLimitRequest = {
  /** Who the budget is charged to — e.g. an owner user id, or `ip:1.2.3.4`. */
  subject: string;
  /** Selects the default budget (limit + window). */
  costCategory: CostCategory;
  /** Optional extra key dimension, e.g. the queue `rateLimitKey`. */
  key?: string;
  /** Override the category's default limit for this call. */
  limit?: number;
  /** Override the category's default window for this call. */
  windowSeconds?: number;
};

export type RateLimitResult = {
  allowed: boolean;
  /** The effective limit applied. */
  limit: number;
  /** Hits counted in the current window (including this one), or null on store error. */
  count: number | null;
  /** Requests left in the window; 0 when denied. */
  remaining: number;
  /** When the current fixed window resets. */
  resetAt: Date;
  costCategory: CostCategory;
  /** Why a request was denied, when `allowed` is false. */
  reason?: "limit_exceeded" | "store_error";
};

/**
 * Counter seam. `increment` adds one to the counter at `key`, ensures it expires
 * after `ttlSeconds`, and returns the post-increment count. Implementations: a
 * Redis adapter (reusing the existing connection) and a deterministic fake.
 */
export type RateLimitStore = {
  increment: (input: { key: string; ttlSeconds: number }) => Promise<number>;
};
