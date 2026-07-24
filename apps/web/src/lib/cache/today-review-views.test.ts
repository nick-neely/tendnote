import { describe, expect, it } from "vitest";
import { todayReviewCacheContract } from "./today-review-views";

describe("Today and Review cache contract", () => {
  it("separates owner and local-day identity while retaining owner-wide mutation tags", () => {
    expect(
      todayReviewCacheContract.today({
        ownerUserId: "owner-a",
        localDate: "2026-07-24",
        timeZone: "America/Chicago",
        refreshedAt: 1_753_376_800_000,
      }),
    ).toEqual({
      key: ["today", "owner-a", "2026-07-24", "America/Chicago", 1_753_376_800_000],
      tags: ["today:owner:owner-a", "today:owner:owner-a:shortlist"],
    });
    expect(
      todayReviewCacheContract.today({
        ownerUserId: "owner-b",
        localDate: "2026-07-24",
        timeZone: "America/Chicago",
        refreshedAt: 1_753_376_800_000,
      }).key,
    ).not.toEqual(
      todayReviewCacheContract.today({
        ownerUserId: "owner-a",
        localDate: "2026-07-24",
        timeZone: "America/Chicago",
        refreshedAt: 1_753_376_800_000,
      }).key,
    );
    expect(todayReviewCacheContract.review({ ownerUserId: "owner-a" })).toEqual({
      key: ["review", "owner-a"],
      tags: ["review:owner:owner-a", "review:owner:owner-a:queue"],
    });
  });
});
