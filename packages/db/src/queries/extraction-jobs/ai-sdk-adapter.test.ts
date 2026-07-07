import { generateText, Output } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAiSdkSuggestedMemoryExtractionAdapter,
  createDefaultSuggestedMemoryExtractionAdapter,
  shouldRunLiveSuggestedMemoryExtractionSmoke,
} from "./ai-sdk-adapter";
import { createHarness } from "./harness";

// vitest hoists `vi.mock` factories above imports, so this `ai` SDK mock cannot be shared
// without dynamic-import gymnastics that obscure the idiom; the two extraction pipelines
// keep separate tests by design (#183).
// fallow-ignore-next-line code-duplication
vi.mock("ai", () => ({
  gateway: vi.fn((modelId: string) => ({ modelId })),
  generateText: vi.fn(),
  Output: {
    object: vi.fn((options) => ({ type: "object-output", ...options })),
  },
}));

const generateTextMock = vi.mocked(generateText);
const outputObjectMock = vi.mocked(Output.object);

beforeEach(() => {
  generateTextMock.mockReset();
  outputObjectMock.mockClear();
});

describe("AI SDK suggested-memory extraction adapter", () => {
  it("extracts structured candidates through the configured AI SDK model", async () => {
    generateTextMock.mockResolvedValue({
      output: {
        candidates: [
          {
            personId: "person-1",
            content: "Mara is trying morning workouts again.",
            memoryType: "context",
          },
        ],
      },
    } as Awaited<ReturnType<typeof generateText>>);
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
    expect(outputObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "suggested_memory_extraction",
      }),
    );
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { modelId: "openai/gpt-5.4" },
        output: expect.objectContaining({ type: "object-output" }),
        system: expect.stringContaining("tentative suggested memories"),
        prompt: expect.stringContaining("Mara: person-1"),
      }),
    );
  });

  it("uses the env model when only the prompt version is overridden", async () => {
    generateTextMock.mockResolvedValue({
      output: { candidates: [] },
    } as Awaited<ReturnType<typeof generateText>>);
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
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { modelId: "openai/gpt-5.4" },
      }),
    );
  });

  it("persists LLM candidates as tentative suggested-memory review records", async () => {
    const harness = createHarness({
      extractionAdapter: createAiSdkSuggestedMemoryExtractionAdapter({
        model: "openai/gpt-5.4",
        env: { AI_GATEWAY_API_KEY: "test-key" },
      }),
    });
    const mara = await harness.createPerson("Mara");
    generateTextMock.mockResolvedValue({
      output: {
        candidates: [
          {
            personId: mara.id,
            content: "Mara is trying morning workouts again.",
            memoryType: "context",
          },
        ],
      },
    } as Awaited<ReturnType<typeof generateText>>);
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
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("fails before calling the model when the extraction model is not configured", async () => {
    const adapter = createDefaultSuggestedMemoryExtractionAdapter({
      AI_GATEWAY_API_KEY: "test-key",
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
    ).rejects.toThrow(/Missing TENDNOTE_EXTRACTION_MODEL/);
    expect(generateTextMock).not.toHaveBeenCalled();
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
    expect(result.error).toMatch(
      /Missing TENDNOTE_EXTRACTION_MODEL|Missing AI Gateway credentials/,
    );
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

  it("requires an explicit flag plus credentials and model for live smoke checks", () => {
    expect(shouldRunLiveSuggestedMemoryExtractionSmoke({})).toBe(false);
    expect(
      shouldRunLiveSuggestedMemoryExtractionSmoke({
        TENDNOTE_RUN_LIVE_EXTRACTION_SMOKE: "1",
        TENDNOTE_EXTRACTION_MODEL: "openai/gpt-5.4",
      }),
    ).toBe(false);
    expect(
      shouldRunLiveSuggestedMemoryExtractionSmoke({
        TENDNOTE_RUN_LIVE_EXTRACTION_SMOKE: "1",
        TENDNOTE_EXTRACTION_MODEL: "openai/gpt-5.4",
        AI_GATEWAY_API_KEY: "test-key",
      }),
    ).toBe(true);
  });
});
