import { embed, generateText, streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { fakeGatewayProvider } from "./model-call-fixtures";
import { hostedEmbeddingModel, hostedModel } from "./model-calls";
import type { ModelUsage } from "./usage-ledger";

const ignoreUsage = async () => {};

function fakeUsageLedger() {
  const entries: ModelUsage[] = [];
  return {
    entries,
    recordUsage: async (usage: ModelUsage) => {
      entries.push(usage);
    },
  };
}

describe("hostedModel", () => {
  it("sends Gemini models to Vertex only, with the privacy flags and the cost category", async () => {
    const fake = fakeGatewayProvider();

    await generateText({
      model: hostedModel(
        { modelId: "google/gemini-3.7-flash", costCategory: "background", account: "user-1" },
        { provider: fake.provider, recordUsage: ignoreUsage },
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
        { modelId: "openai/gpt-6-luna", costCategory: "interactive", account: "user-1" },
        { provider: fake.provider, recordUsage: ignoreUsage },
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
        { modelId: "google/gemini-3.7-flash", costCategory: "interactive", account: "user-1" },
        { provider: fake.provider, recordUsage: ignoreUsage },
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
        { modelId: "google/gemini-3.7-flash", costCategory: "web_search", account: "user-1" },
        { provider: fake.provider, recordUsage: ignoreUsage },
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
      hostedModel(
        { modelId: "anthropic/claude-test", costCategory: "background", account: "user-1" },
        { provider: fake.provider },
      ),
    ).toThrow(/no pinned provider/i);
    expect(fake.models).toEqual([]);
  });
});

describe("hostedEmbeddingModel", () => {
  it("sends OpenAI embeddings to OpenAI only, with the privacy flags and the cost category", async () => {
    const fake = fakeGatewayProvider();

    const { embedding } = await embed({
      model: hostedEmbeddingModel(
        { modelId: "openai/text-embedding-3-small", costCategory: "background", account: "user-1" },
        { provider: fake.provider.embeddingModel, recordUsage: ignoreUsage },
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
        { modelId: "cohere/embed-test", costCategory: "background", account: "user-1" },
        { provider: fake.provider.embeddingModel, recordUsage: ignoreUsage },
      ),
    ).toThrow(/no pinned provider/i);
    expect(fake.embeddingModels).toEqual([]);
  });
});

describe("the Usage Ledger", () => {
  it("meters a generated call to its account, model, and cost category", async () => {
    const fake = fakeGatewayProvider();
    const ledger = fakeUsageLedger();

    await generateText({
      model: hostedModel(
        { modelId: "google/gemini-3.7-flash", costCategory: "background", account: "user-1" },
        { provider: fake.provider, recordUsage: ledger.recordUsage },
      ),
      prompt: "hi",
    });

    expect(ledger.entries).toEqual([
      {
        accountId: "user-1",
        modelId: "google/gemini-3.7-flash",
        costCategory: "background",
        inputTokens: 3,
        outputTokens: 2,
        costMicroUsd: 123,
      },
    ]);
  });

  it("meters a streamed call once, after it finishes", async () => {
    const fake = fakeGatewayProvider();
    const ledger = fakeUsageLedger();

    const result = streamText({
      model: hostedModel(
        { modelId: "google/gemini-3.7-flash", costCategory: "interactive", account: "user-1" },
        { provider: fake.provider, recordUsage: ledger.recordUsage },
      ),
      prompt: "hi",
    });

    expect(await result.text).toBe("ok");
    expect(ledger.entries).toEqual([
      {
        accountId: "user-1",
        modelId: "google/gemini-3.7-flash",
        costCategory: "interactive",
        inputTokens: 3,
        outputTokens: 2,
        costMicroUsd: 123,
      },
    ]);
  });

  it("meters an embedding call's tokens as input", async () => {
    const fake = fakeGatewayProvider();
    const ledger = fakeUsageLedger();

    await embed({
      model: hostedEmbeddingModel(
        { modelId: "openai/text-embedding-3-small", costCategory: "background", account: "user-1" },
        { provider: fake.provider.embeddingModel, recordUsage: ledger.recordUsage },
      ),
      value: "gift ideas",
    });

    expect(ledger.entries).toEqual([
      {
        accountId: "user-1",
        modelId: "openai/text-embedding-3-small",
        costCategory: "background",
        inputTokens: 4,
        outputTokens: 0,
        costMicroUsd: 4,
      },
    ]);
  });

  it("records the cost the gateway reports, which no token count can derive", async () => {
    const ledger = fakeUsageLedger();
    const model = new MockLanguageModelV4({
      modelId: "google/gemini-3.7-flash",
      doGenerate: async () => ({
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1000, noCache: 100, cacheRead: 900, cacheWrite: 0 },
          outputTokens: { total: 10, text: 10, reasoning: 0 },
        },
        providerMetadata: { gateway: { cost: 0.0001425 } },
        warnings: [],
      }),
    });

    await generateText({
      model: hostedModel(
        { modelId: "google/gemini-3.7-flash", costCategory: "interactive", account: "user-1" },
        { provider: () => model, recordUsage: ledger.recordUsage },
      ),
      prompt: "hi",
    });

    expect(ledger.entries[0]?.costMicroUsd).toBe(143);
  });

  it("meters a call with no reported cost as free, and says so", async () => {
    const ledger = fakeUsageLedger();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const model = new MockLanguageModelV4({
      modelId: "google/gemini-3.7-flash",
      doGenerate: async () => ({
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 2, text: 2, reasoning: 0 },
        },
        providerMetadata: { gateway: { cost: "not a number" } },
        warnings: [],
      }),
    });

    await generateText({
      model: hostedModel(
        { modelId: "google/gemini-3.7-flash", costCategory: "interactive", account: "user-1" },
        { provider: () => model, recordUsage: ledger.recordUsage },
      ),
      prompt: "hi",
    });

    expect(ledger.entries[0]).toMatchObject({ inputTokens: 3, costMicroUsd: 0 });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/no cost/), {
      modelId: "google/gemini-3.7-flash",
      costCategory: "interactive",
    });
    warn.mockRestore();
  });

  it("charges each call to the account its resolver names at call time", async () => {
    const fake = fakeGatewayProvider();
    const ledger = fakeUsageLedger();
    let current = "user-1";
    const model = hostedModel(
      { modelId: "google/gemini-3.7-flash", costCategory: "interactive", account: () => current },
      { provider: fake.provider, recordUsage: ledger.recordUsage },
    );

    await generateText({ model, prompt: "hi" });
    current = "user-2";
    await generateText({ model, prompt: "hi" });

    expect(ledger.entries.map((entry) => entry.accountId)).toEqual(["user-1", "user-2"]);
  });

  it("leaves a call with no account unmetered rather than failing it", async () => {
    const fake = fakeGatewayProvider();
    const ledger = fakeUsageLedger();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { text } = await generateText({
      model: hostedModel(
        { modelId: "google/gemini-3.7-flash", costCategory: "interactive", account: () => null },
        { provider: fake.provider, recordUsage: ledger.recordUsage },
      ),
      prompt: "hi",
    });

    expect(text).toBe("ok");
    expect(ledger.entries).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/no account/), {
      modelId: "google/gemini-3.7-flash",
      costCategory: "interactive",
    });
    warn.mockRestore();
  });

  it("leaves a call unmetered rather than failing it when its account resolver throws", async () => {
    const fake = fakeGatewayProvider();
    const ledger = fakeUsageLedger();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { text } = await generateText({
      model: hostedModel(
        {
          modelId: "google/gemini-3.7-flash",
          costCategory: "interactive",
          account: () => {
            throw new Error("no session store");
          },
        },
        { provider: fake.provider, recordUsage: ledger.recordUsage },
      ),
      prompt: "hi",
    });

    expect(text).toBe("ok");
    expect(ledger.entries).toEqual([]);
    warn.mockRestore();
  });

  it("records nothing of the prompt or the reply", async () => {
    const fake = fakeGatewayProvider("Maya's sister is expecting in May");
    const ledger = fakeUsageLedger();

    await generateText({
      model: hostedModel(
        { modelId: "google/gemini-3.7-flash", costCategory: "interactive", account: "user-1" },
        { provider: fake.provider, recordUsage: ledger.recordUsage },
      ),
      prompt: "What did Maya say about person 7f3a?",
    });

    const recorded = JSON.stringify(ledger.entries);
    expect(recorded).not.toMatch(/Maya|sister|7f3a/);
    expect(Object.keys(ledger.entries[0] ?? {}).sort()).toEqual([
      "accountId",
      "costCategory",
      "costMicroUsd",
      "inputTokens",
      "modelId",
      "outputTokens",
    ]);
  });
});

describe("the Fallback Model", () => {
  function interactiveEve(
    overFairUseBudget: (accountId: string) => Promise<boolean>,
    account: () => string | null = () => "user-1",
  ) {
    const fake = fakeGatewayProvider();
    const ledger = fakeUsageLedger();
    const model = hostedModel(
      {
        modelId: "google/gemini-3.7-flash",
        costCategory: "interactive",
        account,
        fallbackModelId: "openai/gpt-6-luna",
      },
      { provider: fake.provider, recordUsage: ledger.recordUsage, overFairUseBudget },
    );
    /** The model each call actually reached, in order. */
    const reached = () =>
      fake.models.flatMap((m) =>
        Array.from({ length: m.doGenerateCalls.length + m.doStreamCalls.length }, () => m.modelId),
      );
    return { fake, ledger, model, reached };
  }

  it("runs on the production model while the account is within its Fair-Use Budget", async () => {
    const eve = interactiveEve(async () => false);

    await generateText({ model: eve.model, prompt: "hi" });

    expect(eve.reached()).toEqual(["google/gemini-3.7-flash"]);
  });

  it("switches to the Fallback Model, pinned and metered as itself, over the budget", async () => {
    const reads: string[] = [];
    const eve = interactiveEve(async (accountId) => {
      reads.push(accountId);
      return true;
    });

    await generateText({ model: eve.model, prompt: "hi" });

    expect(reads).toEqual(["user-1"]);
    expect(eve.reached()).toEqual(["openai/gpt-6-luna"]);
    expect(eve.fake.sentProviderOptions()).toEqual([
      {
        gateway: {
          zeroDataRetention: true,
          disallowPromptTraining: true,
          only: ["openai"],
          tags: ["cost:interactive"],
        },
      },
    ]);
    expect(eve.ledger.entries).toEqual([
      expect.objectContaining({ accountId: "user-1", modelId: "openai/gpt-6-luna" }),
    ]);
  });

  it("decides per call, so a streamed turn switches the moment the budget is crossed", async () => {
    let over = false;
    const eve = interactiveEve(async () => over);

    await streamText({ model: eve.model, prompt: "hi" }).consumeStream();
    over = true;
    await streamText({ model: eve.model, prompt: "hi" }).consumeStream();

    expect(eve.reached()).toEqual(["google/gemini-3.7-flash", "openai/gpt-6-luna"]);
  });

  it("hands the Fallback Model the caller's provider options, so its thinking still shows", async () => {
    const eve = interactiveEve(async () => true);

    await generateText({
      model: eve.model,
      prompt: "hi",
      providerOptions: {
        google: { thinkingConfig: { includeThoughts: true } },
        openai: { reasoningSummary: "auto" },
      },
    });

    expect(eve.fake.sentProviderOptions()).toEqual([
      expect.objectContaining({
        google: { thinkingConfig: { includeThoughts: true } },
        openai: { reasoningSummary: "auto" },
        gateway: expect.objectContaining({ only: ["openai"] }),
      }),
    ]);
  });

  it("stays on the production model when the usage read fails, and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const eve = interactiveEve(async () => {
      throw new Error("database unavailable");
    });

    const { text } = await generateText({ model: eve.model, prompt: "hi" });

    expect(text).toBe("ok");
    expect(eve.reached()).toEqual(["google/gemini-3.7-flash"]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Fallback Model/), {
      modelId: "google/gemini-3.7-flash",
    });
    warn.mockRestore();
  });

  it("does not read usage for a call with no account", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const read = vi.fn(async () => true);
    const eve = interactiveEve(read, () => null);

    await generateText({ model: eve.model, prompt: "hi" });

    expect(read).not.toHaveBeenCalled();
    expect(eve.reached()).toEqual(["google/gemini-3.7-flash"]);
    warn.mockRestore();
  });

  it("refuses a Fallback Model with no pinned provider", () => {
    expect(() =>
      hostedModel(
        {
          modelId: "google/gemini-3.7-flash",
          costCategory: "interactive",
          account: "user-1",
          fallbackModelId: "zai/glm-5.3-flash",
        },
        { provider: fakeGatewayProvider().provider, recordUsage: ignoreUsage },
      ),
    ).toThrow(/No pinned provider for model zai\/glm-5.3-flash/);
  });
});
