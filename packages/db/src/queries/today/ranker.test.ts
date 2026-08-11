import { describe, expect, it } from "vitest";
import { shouldUseTodayRanker } from "./ranker";

describe("Today optional ranking", () => {
  it("stays off in development unless explicitly enabled", () => {
    expect(shouldUseTodayRanker({ NODE_ENV: "development" })).toBe(false);
    expect(
      shouldUseTodayRanker({ NODE_ENV: "development", TENDNOTE_ENABLE_TODAY_RANKING: "1" }),
    ).toBe(true);
  });

  it("remains enabled outside local development", () => {
    expect(shouldUseTodayRanker({ NODE_ENV: "test" })).toBe(true);
    expect(shouldUseTodayRanker({ NODE_ENV: "production" })).toBe(true);
  });
});
