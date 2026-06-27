import { embed } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultSemanticEmbeddingAdapter,
  createDefaultSemanticEmbeddingConfig,
} from "../semantic-retrieval";
import { createAiSdkEmbeddingAdapter } from "./ai-sdk-adapter";

vi.mock("ai", () => ({
  embed: vi.fn(),
}));

const embedMock = vi.mocked(embed);

beforeEach(() => {
  embedMock.mockReset();
});

describe("AI SDK embedding adapter", () => {
  it("embeds through the configured AI SDK model", async () => {
    embedMock.mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      value: "gift ideas",
      usage: { tokens: 2 },
      warnings: [],
      providerMetadata: {},
      response: { headers: undefined },
    });
    const adapter = createAiSdkEmbeddingAdapter();

    const result = await adapter.embedText({
      text: "gift ideas",
      model: "openai/text-embedding-3-small",
      version: "openai/text-embedding-3-small",
    });

    expect(embedMock).toHaveBeenCalledWith({
      model: "openai/text-embedding-3-small",
      value: "gift ideas",
    });
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

    const result = await adapter.embedText({ text: "Alex likes keyboards", ...config });

    expect(config).toEqual({ model: "fake-semantic-retrieval", version: "v1" });
    expect(result.vector).toHaveLength(4);
    expect(embedMock).not.toHaveBeenCalled();
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
