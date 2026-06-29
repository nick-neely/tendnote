import type { CostCategoryBudget } from "./types";

/**
 * Product cost-category budgets (ADR-0070). Each admitted product workload maps to
 * a category with a default per-window limit. The queue consumer categories
 * (`llm-extraction`, `embedding`) match the `costCategory` values registered in the
 * background-job delivery foundation (BACKGROUND_JOB_QUEUE_CONFIG), so consumers
 * pass their existing `costCategory` straight through.
 *
 * These are conservative starting budgets, not auth limits — Better Auth still owns
 * signup/sign-in/session abuse controls.
 */
export const RATE_LIMIT_COST_CATEGORIES = {
  // Chat ingress: bounded so accidental or abusive chat usage can't consume
  // unbounded assistant runtime.
  "eve-ingress": { limit: 30, windowSeconds: 60 },
  // Model-backed server actions (brief/draft generation, capture).
  "server-action": { limit: 60, windowSeconds: 60 },
  // Queue consumer categories — keys match BACKGROUND_JOB_QUEUE_CONFIG.costCategory.
  "llm-extraction": { limit: 20, windowSeconds: 60 },
  embedding: { limit: 60, windowSeconds: 60 },
  // Future provider API calls (Calendar/Gmail/Contacts) share one product budget.
  "provider-call": { limit: 60, windowSeconds: 60 },
} as const satisfies Record<string, CostCategoryBudget>;
