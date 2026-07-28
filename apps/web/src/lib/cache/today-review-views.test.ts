import { describe, expect, it } from "vitest";
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
