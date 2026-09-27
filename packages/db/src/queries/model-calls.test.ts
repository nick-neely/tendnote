import { embed, generateText, streamText } from "ai";
import { describe, expect, it } from "vitest";
import { fakeGatewayProvider } from "./model-call-fixtures";
import { hostedEmbeddingModel, hostedModel } from "./model-calls";

describe("hostedModel", () => {
  it("sends Gemini models to Vertex only, with the privacy flags and the cost category", async () => {
    const fake = fakeGatewayProvider();

    await generateText({
      model: hostedModel(
        { modelId: "google/gemini-3.7-flash", costCategory: "background" },
        fake.provider,
      ),
      prompt: "hi",
    });

    expect(fake.models.map((m) => m.modelId)).toEqual(["google/gemini-3.7-flash"]);
    expect(fake.sentProviderOptions()).toEqual([
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

  it("sends OpenAI models to OpenAI only", async () => {
    const fake = fakeGatewayProvider();

    await generateText({
      model: hostedModel(
        { modelId: "openai/gpt-6-luna", costCategory: "interactive" },
        fake.provider,
      ),
      prompt: "hi",
    });

    expect(fake.sentProviderOptions()).toEqual([
      {
        gateway: {
          zeroDataRetention: true,
          disallowPromptTraining: true,
          only: ["openai"],
          tags: ["cost:interactive"],
        },
      },
    ]);
  });

  it("sends the same options on streamed calls", async () => {
    const fake = fakeGatewayProvider();

    const result = streamText({
      model: hostedModel(
        { modelId: "google/gemini-3.7-flash", costCategory: "interactive" },
        fake.provider,
      ),
      prompt: "hi",
    });

    expect(await result.text).toBe("ok");
    expect(fake.sentProviderOptions()).toEqual([
      {
        gateway: {
          zeroDataRetention: true,
          disallowPromptTraining: true,
          only: ["vertex"],
          tags: ["cost:interactive"],
        },
      },
    ]);
  });

  it("replaces caller-authored gateway routing but keeps other provider options", async () => {
    const fake = fakeGatewayProvider();

    await generateText({
      model: hostedModel(
        { modelId: "google/gemini-3.7-flash", costCategory: "web_search" },
        fake.provider,
      ),
      prompt: "hi",
      providerOptions: {
        google: { thinkingConfig: { includeThoughts: true } },
        gateway: { zeroDataRetention: false, only: ["google"], models: ["anthropic/claude-test"] },
      },
    });

    expect(fake.sentProviderOptions()).toEqual([
      {
        google: { thinkingConfig: { includeThoughts: true } },
        gateway: {
          zeroDataRetention: true,
          disallowPromptTraining: true,
          only: ["vertex"],
          tags: ["cost:web_search"],
        },
      },
    ]);
  });

  it("refuses a model with no pinned provider", () => {
    const fake = fakeGatewayProvider();

    expect(() =>
      hostedModel({ modelId: "anthropic/claude-test", costCategory: "background" }, fake.provider),
    ).toThrow(/no pinned provider/i);
    expect(fake.models).toEqual([]);
  });
});

describe("hostedEmbeddingModel", () => {
  it("sends OpenAI embeddings to OpenAI only, with the privacy flags and the cost category", async () => {
    const fake = fakeGatewayProvider();

    const { embedding } = await embed({
      model: hostedEmbeddingModel(
        { modelId: "openai/text-embedding-3-small", costCategory: "background" },
        fake.provider.embeddingModel,
      ),
      value: "gift ideas",
    });

    expect(embedding).toEqual([0.1, 0.2, 0.3]);
    expect(fake.embeddingModels.map((m) => m.modelId)).toEqual(["openai/text-embedding-3-small"]);
    expect(fake.sentProviderOptions()).toEqual([
      {
        gateway: {
          zeroDataRetention: true,
          disallowPromptTraining: true,
          only: ["openai"],
          tags: ["cost:background"],
        },
      },
    ]);
  });

  it("refuses an embedding model with no pinned provider", () => {
    const fake = fakeGatewayProvider();

    expect(() =>
      hostedEmbeddingModel(
        { modelId: "cohere/embed-test", costCategory: "background" },
        fake.provider.embeddingModel,
      ),
    ).toThrow(/no pinned provider/i);
    expect(fake.embeddingModels).toEqual([]);
  });
});
