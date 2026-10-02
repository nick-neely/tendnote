import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultSemanticEmbeddingAdapter,
  createDefaultSemanticEmbeddingConfig,
} from "../semantic-retrieval";
import { createAiSdkEmbeddingAdapter } from "./ai-sdk-adapter";

// The real AI SDK runs against a fake gateway, so the test sees the request the
// model-call entry point actually sends.
const fakeGateway = vi.hoisted(async () => {
  const { fakeGatewayProvider } = await import("../model-call-fixtures");
  return fakeGatewayProvider();
});

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  gateway: (await fakeGateway).provider,
}));

const recordModelUsage = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../usage-ledger", () => ({ recordModelUsage }));

beforeEach(async () => {
  (await fakeGateway).reset();
});

describe("AI SDK embedding adapter", () => {
  it("embeds through the model-call entry point on the configured model", async () => {
    const adapter = createAiSdkEmbeddingAdapter();

    const result = await adapter.embedText(
      {
        text: "gift ideas",
        model: "openai/text-embedding-3-small",
        version: "openai/text-embedding-3-small",
      },
      { accountId: "owner-1" },
    );

    const { embeddingModels, sentProviderOptions } = await fakeGateway;
    expect(embeddingModels.map((m) => m.modelId)).toEqual(["openai/text-embedding-3-small"]);
    expect(embeddingModels[0]?.doEmbedCalls.map((c) => c.values)).toEqual([["gift ideas"]]);
    expect(recordModelUsage).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "owner-1", costCategory: "background" }),
    );
    expect(sentProviderOptions()).toEqual([
      {
        gateway: {
          zeroDataRetention: true,
          disallowPromptTraining: true,
          only: ["openai"],
          tags: ["cost:background"],
        },
      },
    ]);
    expect(result).toEqual({
      vector: [0.1, 0.2, 0.3],
      model: "openai/text-embedding-3-small",
      version: "openai/text-embedding-3-small",
    });
  });
});

describe("default semantic embedding configuration", () => {
  it("falls back to fake embeddings when gateway credentials are absent", async () => {
    const config = createDefaultSemanticEmbeddingConfig({});
    const adapter = createDefaultSemanticEmbeddingAdapter({});

    const result = await adapter.embedText(
      { text: "Alex likes keyboards", ...config },
      { accountId: "owner-1" },
    );

    expect(config).toEqual({ model: "fake-semantic-retrieval", version: "v2" });
    expect(result.vector).toHaveLength(64);
    expect((await fakeGateway).embeddingModels).toEqual([]);
  });

  it("uses the configured gateway embedding model when credentials are present", () => {
    expect(
      createDefaultSemanticEmbeddingConfig({
        AI_GATEWAY_API_KEY: "test-key",
        TENDNOTE_EMBEDDING_MODEL: "openai/text-embedding-3-small",
        TENDNOTE_EMBEDDING_VERSION: "openai-v3-small",
      }),
    ).toEqual({
      model: "openai/text-embedding-3-small",
      version: "openai-v3-small",
    });
  });
});
