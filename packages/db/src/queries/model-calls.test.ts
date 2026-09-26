import { generateText } from "ai";
import { describe, expect, it } from "vitest";
import { fakeGatewayProvider } from "./model-call-fixtures";
import { hostedModel } from "./model-calls";

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
