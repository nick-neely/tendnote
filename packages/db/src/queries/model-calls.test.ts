import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { hostedModel } from "./model-calls";

function fakeProvider() {
  const models: MockLanguageModelV4[] = [];
  const provider = (modelId: string) => {
    const model = new MockLanguageModelV4({
      modelId,
      doGenerate: {
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      },
    });
    models.push(model);
    return model;
  };
  const sentProviderOptions = () =>
    models.flatMap((m) => m.doGenerateCalls).map((c) => c.providerOptions);
  return { provider, models, sentProviderOptions };
}

describe("hostedModel", () => {
  it("sends Gemini models to Vertex only, with the privacy flags and the cost category", async () => {
    const fake = fakeProvider();

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
    const fake = fakeProvider();

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

  it("replaces caller-authored gateway routing but keeps other provider options", async () => {
    const fake = fakeProvider();

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
    const fake = fakeProvider();

    expect(() =>
      hostedModel({ modelId: "anthropic/claude-test", costCategory: "background" }, fake.provider),
    ).toThrow(/no pinned provider/i);
    expect(fake.models).toEqual([]);
  });
});
