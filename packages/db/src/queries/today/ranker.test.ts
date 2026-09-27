import { describe, expect, it, vi } from "vitest";
import { createAiSdkTodayRanker, shouldUseTodayRanker } from "./ranker";

// The real AI SDK runs against a fake gateway, so the test sees the request the
// model-call entry point actually sends.
const fakeGateway = vi.hoisted(async () => {
  const { fakeGatewayProvider } = await import("../model-call-fixtures");
  return fakeGatewayProvider(JSON.stringify({ orderedIdentities: ["action:1", "person:2"] }));
});

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  gateway: (await fakeGateway).provider,
}));

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

  it("ranks through the model-call entry point on the production model", async () => {
    const rank = createAiSdkTodayRanker({ env: { AI_GATEWAY_API_KEY: "test-key" } });

    await expect(
      rank({ ownerUserId: "owner-1", localDate: "2026-06-01", candidates: [] }),
    ).resolves.toEqual({ orderedIdentities: ["action:1", "person:2"] });
    const { models, calls, sentProviderOptions } = await fakeGateway;
    expect(models.map((m) => m.modelId)).toEqual(["google/gemini-3.7-flash"]);
    expect(calls()[0]?.responseFormat).toMatchObject({
      type: "json",
      name: "today_optional_ranking",
    });
    expect(sentProviderOptions()).toEqual([
      {
        gateway: {
          zeroDataRetention: true,
          disallowPromptTraining: true,
          only: ["vertex"],
          tags: ["cost:background"],
        },
      },
    ]);
  });
});
