import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAiSdkSuggestedMemoryExtractionAdapter,
  createDefaultSuggestedMemoryExtractionAdapter,
  shouldRunLiveSuggestedMemoryExtractionSmoke,
} from "./ai-sdk-adapter";
import { createHarness } from "./harness";

// The real AI SDK runs against a fake gateway, so the test sees the request the
// model-call entry point actually sends. The two extraction pipelines keep separate
// tests by design (#183).
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

async function respondWith(output: unknown) {
  (await fakeGateway).respondWith(JSON.stringify(output));
}

describe("AI SDK suggested-memory extraction adapter", () => {
  it("extracts structured candidates through the configured AI SDK model", async () => {
    await respondWith({
      candidates: [
        {
          personId: "person-1",
          content: "Mara is trying morning workouts again.",
          memoryType: "context",
        },
      ],
    });
    const adapter = createAiSdkSuggestedMemoryExtractionAdapter({
      model: "openai/gpt-5.4",
      env: { AI_GATEWAY_API_KEY: "test-key" },
    });

    const result = await adapter.extractCandidates({
      sourceRecord: {
        id: "source-1",
        ownerUserId: "owner-1",
        content: "Mara is trying morning workouts again.",
        sensitivity: "normal",
        confidence: "medium",
        importance: 3,
      },
      resolvedPeople: [{ id: "person-1", displayName: "Mara" }],
    });

    expect(result.candidates).toHaveLength(1);
    const { models, calls, sentPrompts, sentProviderOptions } = await fakeGateway;
    expect(models.map((m) => m.modelId)).toEqual(["openai/gpt-5.4"]);
    expect(calls()[0]?.responseFormat).toMatchObject({
      type: "json",
      name: "suggested_memory_extraction",
    });
    expect(sentPrompts()[0]).toContain("tentative suggested memories");
    expect(sentPrompts()[0]).toContain("Mara: person-1");
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
  });

  it("uses the env model when only the prompt version is overridden", async () => {
    await respondWith({ candidates: [] });
    const adapter = createAiSdkSuggestedMemoryExtractionAdapter({
      promptVersion: "fixture.prompt.v2",
      env: {
        AI_GATEWAY_API_KEY: "test-key",
        TENDNOTE_EXTRACTION_MODEL: "openai/gpt-5.4",
      },
    });

    await adapter.extractCandidates({
      sourceRecord: {
        id: "source-1",
        ownerUserId: "owner-1",
        content: "No durable fact.",
        sensitivity: "normal",
        confidence: "medium",
        importance: 3,
      },
      resolvedPeople: [],
    });

    expect(adapter).toMatchObject({
      kind: "llm",
      model: "openai/gpt-5.4",
      promptVersion: "fixture.prompt.v2",
    });
    expect((await fakeGateway).models.map((m) => m.modelId)).toEqual(["openai/gpt-5.4"]);
  });

  it("persists LLM candidates as tentative suggested-memory review records", async () => {
    const harness = createHarness({
      extractionAdapter: createAiSdkSuggestedMemoryExtractionAdapter({
        model: "openai/gpt-5.4",
        env: { AI_GATEWAY_API_KEY: "test-key" },
      }),
    });
    const mara = await harness.createPerson("Mara");
    await respondWith({
      candidates: [
        {
          personId: mara.id,
          content: "Mara is trying morning workouts again.",
          memoryType: "context",
        },
      ],
    });
    const sourceRecord = await harness.captureRecord({
      retainedContent: "Mara is trying morning workouts again.",
    });
    await harness.link(sourceRecord.id, mara.id);
    const { job } = await harness.processor.enqueueExtractionJob({
      sourceRecordId: sourceRecord.id,
    });

    const result = await harness.processor.processExtractionJob({ jobId: job.id });

    expect(result.outcome).toBe("completed");
    expect(result.suggestedMemories).toHaveLength(1);
    expect(result.suggestedMemories[0]).toMatchObject({
      personId: mara.id,
      sourceRecordId: sourceRecord.id,
      status: "suggested",
      content: "Mara is trying morning workouts again.",
    });
    await expect(
      harness.store.listApprovedMemoriesForPerson({ ownerUserId: "owner-1", personId: mara.id }),
    ).resolves.toEqual([]);
  });

  it("fails before calling the model when provider credentials are missing", async () => {
    const adapter = createAiSdkSuggestedMemoryExtractionAdapter({
      model: "openai/gpt-5.4",
      env: {},
    });

    await expect(
      adapter.extractCandidates({
        sourceRecord: {
          id: "source-1",
          ownerUserId: "owner-1",
          content: "Mark likes trail running.",
          sensitivity: "normal",
          confidence: "medium",
          importance: 3,
        },
        resolvedPeople: [{ id: "person-1", displayName: "Mark" }],
      }),
    ).rejects.toThrow(/Missing AI Gateway credentials/);
    expect((await fakeGateway).models).toEqual([]);
  });

  it("uses the production extraction default when no dedicated model is configured", async () => {
    await respondWith({ candidates: [] });
    const adapter = createDefaultSuggestedMemoryExtractionAdapter({
      AI_GATEWAY_API_KEY: "test-key",
    });

    await adapter.extractCandidates({
      sourceRecord: {
        id: "source-1",
        ownerUserId: "owner-1",
        content: "Mark likes trail running.",
        sensitivity: "normal",
        confidence: "medium",
        importance: 3,
      },
      resolvedPeople: [{ id: "person-1", displayName: "Mark" }],
    });

    expect(adapter.model).toBe("google/gemini-3.1-flash-lite");
    // Extraction stays on Gemini 3.1 Flash Lite, pinned to Vertex.
    const { models, sentProviderOptions } = await fakeGateway;
    expect(models.map((m) => m.modelId)).toEqual(["google/gemini-3.1-flash-lite"]);
    expect(sentProviderOptions()).toEqual([
      expect.objectContaining({ gateway: expect.objectContaining({ only: ["vertex"] }) }),
    ]);
  });

  it("turns missing production config into a retryable extraction job failure", async () => {
    const harness = createHarness({
      extractionAdapter: createDefaultSuggestedMemoryExtractionAdapter({}),
    });
    const mark = await harness.createPerson("Mark");
    const sourceRecord = await harness.captureRecord({
      retainedContent: "Mark likes trail running.",
    });
    await harness.link(sourceRecord.id, mark.id);
    const now = new Date("2026-01-01T00:00:00.000Z");
    const { job } = await harness.processor.enqueueExtractionJob({
      sourceRecordId: sourceRecord.id,
      runAfter: now,
    });

    const result = await harness.processor.processExtractionJob({
      jobId: job.id,
      now,
      retryDelayMs: 60_000,
    });

    expect(result.outcome).toBe("failed");
    expect(result.error).toMatch(/Missing AI Gateway credentials/);
    expect(result.job).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: expect.any(String),
      claimedAt: null,
    });
    expect(result.job.runAfter?.toISOString()).toBe("2026-01-01T00:01:00.000Z");
    await expect(
      harness.store.listMemoriesForSourceRecord({ sourceRecordId: sourceRecord.id }),
    ).resolves.toEqual([]);
  });

  it("requires an explicit flag plus credentials for live smoke checks", () => {
    expect(shouldRunLiveSuggestedMemoryExtractionSmoke({})).toBe(false);
    expect(
      shouldRunLiveSuggestedMemoryExtractionSmoke({
        TENDNOTE_RUN_LIVE_EXTRACTION_SMOKE: "1",
        AI_GATEWAY_API_KEY: "test-key",
      }),
    ).toBe(true);
    expect(
      shouldRunLiveSuggestedMemoryExtractionSmoke({
        TENDNOTE_RUN_LIVE_EXTRACTION_SMOKE: "1",
        TENDNOTE_EXTRACTION_MODEL: "openai/gpt-5.4",
        AI_GATEWAY_API_KEY: "test-key",
      }),
    ).toBe(true);
  });
});
