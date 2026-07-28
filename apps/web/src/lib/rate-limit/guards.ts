import "server-only";

import { getProductRateLimiter } from ".";
import { ProductRateLimitError } from "./errors";
import type { ProductRateLimiter } from "./limiter";
import type { RateLimitRequest, RateLimitResult } from "./types";

export { ProductRateLimitError } from "./errors";

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
