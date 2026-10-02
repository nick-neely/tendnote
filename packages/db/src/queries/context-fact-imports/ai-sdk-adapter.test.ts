import { describe, expect, it, vi } from "vitest";
import { createDefaultContextFactImportAdapter } from "./ai-sdk-adapter";

// The real AI SDK runs against a fake gateway, so the test sees the request the
// model-call entry point actually sends.
const fakeGateway = vi.hoisted(async () => {
  const { fakeGatewayProvider } = await import("../model-call-fixtures");
  return fakeGatewayProvider(JSON.stringify({ candidates: [] }));
});

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  gateway: (await fakeGateway).provider,
}));

const recordModelUsage = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../usage-ledger", () => ({ recordModelUsage }));

describe("Self Context import model adapter", () => {
  it("has no model fallback without gateway credentials", () => {
    expect(createDefaultContextFactImportAdapter({})).toBeUndefined();
  });

  it("reads the paste through the model-call entry point on Gemini 3.1 Flash Lite pinned to Vertex", async () => {
    const adapter = createDefaultContextFactImportAdapter({ AI_GATEWAY_API_KEY: "test-key" });

    await expect(
      adapter?.extractCandidates({ text: "I live in Denver." }, { accountId: "owner-1" }),
    ).resolves.toEqual({
      candidates: [],
    });
    const { models, calls, sentPrompts, sentProviderOptions } = await fakeGateway;
    expect(models.map((m) => m.modelId)).toEqual(["google/gemini-3.1-flash-lite"]);
    expect(calls()[0]?.responseFormat).toMatchObject({ name: "context_fact_import" });
    expect(sentPrompts()[0]).toContain("I live in Denver.");
    expect(recordModelUsage).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "owner-1", costCategory: "background" }),
    );
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
