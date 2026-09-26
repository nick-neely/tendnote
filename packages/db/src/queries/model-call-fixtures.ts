import { MockLanguageModelV4 } from "ai/test";

/**
 * A fake gateway provider for tests: the real AI SDK runs against it, so a test
 * asserts the request the model-call entry point actually sends rather than
 * how it was built.
 */
export function fakeGatewayProvider(text = "ok") {
  const models: MockLanguageModelV4[] = [];
  const provider = (modelId: string) => {
    const model = new MockLanguageModelV4({
      modelId,
      doGenerate: {
        content: [{ type: "text", text }],
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
