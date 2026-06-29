import "server-only";

import { getProductRateLimiter } from ".";
import type { ProductRateLimiter } from "./limiter";
import type { RateLimitRequest, RateLimitResult } from "./types";

/**
 * Thrown when a product rate-limited entry point exceeds its budget. Server
 * actions let this propagate so the caller fails closed rather than running
 * expensive work (#103, ADR-0070).
 */
export class ProductRateLimitError extends Error {
  readonly result: RateLimitResult;

  constructor(result: RateLimitResult) {
    super("You've reached a usage limit for this action. Please try again shortly.");
    this.name = "ProductRateLimitError";
    this.result = result;
  }
}

/**
 * Charge the product budget for an admitted product action, throwing
 * {@link ProductRateLimitError} when it is exhausted or the counter is
 * unavailable (fail closed). The limiter is injectable for tests.
 */
export async function enforceProductBudget(
  request: RateLimitRequest,
  limiter: ProductRateLimiter = getProductRateLimiter(),
): Promise<RateLimitResult> {
  const result = await limiter.check(request);

  if (!result.allowed) {
    throw new ProductRateLimitError(result);
  }

  return result;
}
