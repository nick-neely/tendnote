import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside an RSC bundle; stub it so the module loads in tests.
vi.mock("server-only", () => ({}));

import { createFakeRateLimitStore } from "./fake-store";
import { enforceProductBudget, ProductRateLimitError } from "./guards";
import { createProductRateLimiter } from "./limiter";

function limiterWithLimit(limit: number) {
  return createProductRateLimiter(createFakeRateLimitStore(), {
    now: () => 1_000_000_000_000,
    categories: {
      "eve-ingress": { limit, windowSeconds: 60 },
      "server-action": { limit, windowSeconds: 60 },
      "llm-extraction": { limit, windowSeconds: 60 },
      embedding: { limit, windowSeconds: 60 },
      "provider-call": { limit, windowSeconds: 60 },
      "push-delivery": { limit, windowSeconds: 60 },
    },
  });
}

describe("enforceProductBudget", () => {
  it("returns the result while under budget", async () => {
    const limiter = limiterWithLimit(2);
    const result = await enforceProductBudget(
      { subject: "user-1", costCategory: "server-action" },
      limiter,
    );
    expect(result.allowed).toBe(true);
  });

  it("throws ProductRateLimitError once the budget is exhausted", async () => {
    const limiter = limiterWithLimit(1);
    await enforceProductBudget({ subject: "user-1", costCategory: "server-action" }, limiter);

    await expect(
      enforceProductBudget({ subject: "user-1", costCategory: "server-action" }, limiter),
    ).rejects.toBeInstanceOf(ProductRateLimitError);
  });
});
