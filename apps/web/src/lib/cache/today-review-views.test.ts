import { describe, expect, it, vi } from "vitest";

// This cache-contract test does not exercise Calendar reads. Keep the server-only
// Better Auth runtime outside the collection graph while the production seam stays
// injected into today-review-views.ts.
vi.mock("@/lib/integrations/calendar-runtime", () => ({
  createOwnerCalendarReader: vi.fn(),
}));

import { todayReviewCacheContract } from "./today-review-views";

describe("Today and Review cache contract", () => {
  it("derives owner-wide tags from the Today and Review mutation scopes", () => {
    expect(todayReviewCacheContract.today({ ownerUserId: "owner-a" })).toEqual({
      tags: ["today:owner:owner-a", "today:owner:owner-a:shortlist"],
    });
    expect(todayReviewCacheContract.review({ ownerUserId: "owner-a" })).toEqual({
      tags: ["review:owner:owner-a", "review:owner:owner-a:queue"],
    });
  });
});
