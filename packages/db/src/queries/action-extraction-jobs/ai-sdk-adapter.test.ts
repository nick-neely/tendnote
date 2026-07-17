import { generateText, Output } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAiSdkSuggestedActionExtractionAdapter,
  createDefaultSuggestedActionExtractionAdapter,
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

const sourceRecord = {
  id: "source-1",
  ownerUserId: "owner-1",
  content: "Fridge filter is due — replace it every six months.",
  sensitivity: "normal" as const,
  scope: "private" as const,
  importance: 3,
};

describe("AI SDK suggested-action extraction adapter", () => {
  it("extracts structured candidates through the configured AI SDK model", async () => {
    generateTextMock.mockResolvedValue({
      output: {
        candidates: [
          {
            title: "Replace the refrigerator water filter",
            recurrence: { interval: 6, unit: "month" },
          },
        ],
      },
    } as Awaited<ReturnType<typeof generateText>>);
    const adapter = createAiSdkSuggestedActionExtractionAdapter({
      model: "openai/gpt-5.4",
      env: { AI_GATEWAY_API_KEY: "test-key" },
    });

    const result = await adapter.extractActions({
      sourceRecord,
      resolvedPeople: [{ id: "person-1", displayName: "Mara" }],
      availableAreas: [{ id: "area-1", name: "Home" }],
    });

    expect(result.candidates).toHaveLength(1);
    expect(outputObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "suggested_action_extraction" }),
    );
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { modelId: "openai/gpt-5.4" },
        output: expect.objectContaining({ type: "object-output" }),
        system: expect.stringContaining("review-gated action suggestions"),
        prompt: expect.stringContaining("Mara: person-1"),
      }),
    );
    // The Area list is offered to the model so it can file under an existing Area.
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.stringContaining("Home: area-1") }),
    );
  });

  it("fails before calling the model when provider credentials are missing", async () => {
    const adapter = createAiSdkSuggestedActionExtractionAdapter({
      model: "openai/gpt-5.4",
      env: {},
    });

    await expect(
      adapter.extractActions({ sourceRecord, resolvedPeople: [], availableAreas: [] }),
    ).rejects.toThrow(/Missing AI Gateway credentials/);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("uses the production extraction default when no dedicated model is configured", async () => {
    generateTextMock.mockResolvedValue({
      output: { candidates: [] },
    } as Awaited<ReturnType<typeof generateText>>);
    const adapter = createDefaultSuggestedActionExtractionAdapter({
      AI_GATEWAY_API_KEY: "test-key",
    });

    await adapter.extractActions({ sourceRecord, resolvedPeople: [], availableAreas: [] });

    expect(adapter.model).toBe("google/gemini-3.1-flash-lite");
    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: { modelId: "google/gemini-3.1-flash-lite" } }),
    );
  });

  it("turns missing production config into a retryable action job failure", async () => {
    const harness = createHarness({
      extractionAdapter: createDefaultSuggestedActionExtractionAdapter({}),
    });
    const source = await harness.captureRecord({ content: "Replace the filter every six months." });
    const now = new Date("2026-01-01T00:00:00.000Z");
    const { job } = await harness.processor.enqueueActionExtractionJob({
      sourceRecordId: source.id,
      runAfter: now,
    });

    const result = await harness.processor.processActionExtractionJob({
      jobId: job.id,
      now,
      retryDelayMs: 60_000,
    });

    expect(result.outcome).toBe("failed");
    expect(result.error).toMatch(/Missing AI Gateway credentials/);
    expect(result.job).toMatchObject({ status: "failed", attempts: 1, claimedAt: null });
    expect(result.job.runAfter?.toISOString()).toBe("2026-01-01T00:01:00.000Z");
    await expect(harness.listActionsForSource(source.id)).resolves.toHaveLength(0);
  });
});
