import { MockEmbeddingModelV4, MockLanguageModelV4, simulateReadableStream } from "ai/test";

const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
};

/** What the real gateway reports charging, as `providerMetadata.gateway.cost` in dollars. */
const providerMetadata = { gateway: { cost: "0.000123" } };
const embeddingProviderMetadata = { gateway: { cost: "0.000004" } };

type SentPrompt = MockLanguageModelV4["doGenerateCalls"][number]["prompt"];

function promptText(prompt: SentPrompt) {
  return prompt
    .flatMap((message) =>
      typeof message.content === "string"
        ? [message.content]
        : message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])),
    )
    .join("\n");
}

/**
 * A fake gateway provider for tests: the real AI SDK runs against it, so a test
 * asserts the request the model-call entry point actually sends rather than
 * how it was built. `respondWith` changes the reply for later calls, `reset`
 * forgets earlier calls, and `provider.embeddingModel` fakes the gateway's
 * embedding models.
 */
export function fakeGatewayProvider(text = "ok") {
  let reply = text;
  const models: MockLanguageModelV4[] = [];
  const embeddingModels: MockEmbeddingModelV4[] = [];
  const languageModel = (modelId: string) => {
    const model = new MockLanguageModelV4({
      modelId,
      doGenerate: async () => ({
        content: [{ type: "text", text: reply }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        providerMetadata,
        warnings: [],
      }),
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: reply },
            { type: "text-end", id: "t" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage,
              providerMetadata,
            },
          ],
        }),
      }),
    });
    models.push(model);
    return model;
  };
  const embeddingModel = (modelId: string) => {
    const model = new MockEmbeddingModelV4({
      modelId,
      doEmbed: async ({ values }) => ({
        embeddings: values.map(() => [0.1, 0.2, 0.3]),
        usage: { tokens: 4 },
        providerMetadata: embeddingProviderMetadata,
        warnings: [],
      }),
    });
    embeddingModels.push(model);
    return model;
  };
  const provider = Object.assign(languageModel, { embeddingModel });
  const calls = () => models.flatMap((m) => [...m.doGenerateCalls, ...m.doStreamCalls]);
  const sentProviderOptions = () => [
    ...calls().map((c) => c.providerOptions),
    ...embeddingModels.flatMap((m) => m.doEmbedCalls).map((c) => c.providerOptions),
  ];
  const sentPrompts = () => calls().map((c) => promptText(c.prompt));
  const respondWith = (next: string) => {
    reply = next;
  };
  const reset = () => {
    models.length = 0;
    embeddingModels.length = 0;
    reply = text;
  };
  return {
    provider,
    models,
    embeddingModels,
    calls,
    sentProviderOptions,
    sentPrompts,
    respondWith,
    reset,
  };
}
