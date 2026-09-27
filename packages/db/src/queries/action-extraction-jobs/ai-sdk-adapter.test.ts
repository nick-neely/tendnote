import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAiSdkSuggestedActionExtractionAdapter,
  createDefaultSuggestedActionExtractionAdapter,
} from "./ai-sdk-adapter";
import { createHarness } from "./harness";

// The real AI SDK runs against a fake gateway, so the test sees the request the
// model-call entry point actually sends. The two extraction pipelines keep separate
// tests by design (#183).
// fallow-ignore-next-line code-duplication
const fakeGateway = vi.hoisted(async () => {
  const { fakeGatewayProvider } = await import("../model-call-fixtures");
  return fakeGatewayProvider();
});

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  gateway: (await fakeGateway).provider,
}));

beforeEach(async () => {
  (await fakeGateway).reset();
});

async function respondWith(output: unknown) {
  (await fakeGateway).respondWith(JSON.stringify(output));
}

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
    await respondWith({
      candidates: [
        {
          title: "Replace the refrigerator water filter",
          recurrence: { interval: 6, unit: "month" },
        },
      ],
    });
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
    const { models, calls, sentPrompts, sentProviderOptions } = await fakeGateway;
    expect(models.map((m) => m.modelId)).toEqual(["openai/gpt-5.4"]);
    expect(calls()[0]?.responseFormat).toMatchObject({
      type: "json",
      name: "suggested_action_extraction",
    });
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
    const prompt = sentPrompts()[0];
    expect(prompt).toContain("review-gated action suggestions");
    expect(prompt).toContain("Mara: person-1");
    // The Area list is offered to the model so it can file under an existing Area.
    expect(prompt).toContain("Home: area-1");
    expect(prompt).toContain("Preserve explicit urgency or difficulty wording");
    expect(prompt).not.toMatch(/priority|effort|low\/normal\/high|small\/medium\/large/i);
  });

  it("fails before calling the model when provider credentials are missing", async () => {
    const adapter = createAiSdkSuggestedActionExtractionAdapter({
      model: "openai/gpt-5.4",
      env: {},
    });

    await expect(
      adapter.extractActions({ sourceRecord, resolvedPeople: [], availableAreas: [] }),
    ).rejects.toThrow(/Missing AI Gateway credentials/);
    expect((await fakeGateway).models).toEqual([]);
  });

  it("uses the production extraction default when no dedicated model is configured", async () => {
    await respondWith({ candidates: [] });
    const adapter = createDefaultSuggestedActionExtractionAdapter({
      AI_GATEWAY_API_KEY: "test-key",
    });

    await adapter.extractActions({ sourceRecord, resolvedPeople: [], availableAreas: [] });

    expect(adapter.model).toBe("google/gemini-3.1-flash-lite");
    // Extraction stays on Gemini 3.1 Flash Lite, pinned to Vertex.
    const { models, sentProviderOptions } = await fakeGateway;
    expect(models.map((m) => m.modelId)).toEqual(["google/gemini-3.1-flash-lite"]);
    expect(sentProviderOptions()).toEqual([
      expect.objectContaining({ gateway: expect.objectContaining({ only: ["vertex"] }) }),
    ]);
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
