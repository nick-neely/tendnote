import { describe, expect, it, vi } from "vitest";
import {
  createAiSdkContextFactExtractionAdapter,
  createDefaultContextFactExtractionAdapter,
  hasContextFactExtractionCredentials,
  shouldRunLiveContextFactExtractionQualityEval,
} from "./ai-sdk-adapter";

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

describe("Context Fact extraction model adapter", () => {
  it("keeps model evaluation explicitly opt-in and credential-gated", () => {
    expect(hasContextFactExtractionCredentials({})).toBe(false);
    expect(hasContextFactExtractionCredentials({ AI_GATEWAY_API_KEY: "test" })).toBe(true);
    expect(shouldRunLiveContextFactExtractionQualityEval({})).toBe(false);
    expect(
      shouldRunLiveContextFactExtractionQualityEval({
        AI_GATEWAY_API_KEY: "test",
        TENDNOTE_RUN_LIVE_CONTEXT_FACT_EVAL: "1",
      }),
    ).toBe(true);
  });

  it("does not call a provider without credentials", async () => {
    const adapter = createAiSdkContextFactExtractionAdapter({ env: {} });
    await expect(
      adapter.extractCandidates({ message: "I work in Chicago." }, { accountId: "owner-1" }),
    ).rejects.toThrow("Missing AI Gateway credentials");
    expect((await fakeGateway).models).toEqual([]);
  });

  it("extracts through the model-call entry point on Gemini 3.1 Flash Lite pinned to Vertex", async () => {
    const adapter = createDefaultContextFactExtractionAdapter({ AI_GATEWAY_API_KEY: "test-key" });

    await expect(
      adapter.extractCandidates({ message: "I work in Chicago." }, { accountId: "owner-1" }),
    ).resolves.toEqual({
      candidates: [],
    });
    const { models, calls, sentPrompts, sentProviderOptions } = await fakeGateway;
    expect(models.map((m) => m.modelId)).toEqual(["google/gemini-3.1-flash-lite"]);
    expect(calls()[0]?.responseFormat).toMatchObject({ name: "context_fact_extraction" });
    expect(sentPrompts()[0]).toContain("I work in Chicago.");
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

  it("defaults to the explicit context-fact prompt family", () => {
    const adapter = createDefaultContextFactExtractionAdapter({});
    expect(adapter).toMatchObject({ kind: "llm", promptVersion: "context-fact-extraction.v1" });
  });
});
