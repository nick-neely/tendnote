import { type BriefSummaryInput, DETERMINISTIC_BRIEF_SUMMARY_VERSION } from "@tendnote/domain";
import type { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { createDefaultBriefSummaryAdapter } from "../briefs";

// A fake gateway: the real AI SDK runs, so the test sees the request the
// model-call entry point actually sends.
const fakeGateway = vi.hoisted(() => ({ models: [] as MockLanguageModelV4[] }));

vi.mock("ai", async (importOriginal) => {
  const ai = await importOriginal<typeof import("ai")>();
  const { MockLanguageModelV4 } = await import("ai/test");
  return {
    ...ai,
    gateway: (modelId: string) => {
      const model = new MockLanguageModelV4({
        modelId,
        doGenerate: {
          content: [{ type: "text", text: "LLM-written brief summary." }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
          warnings: [],
        },
      });
      fakeGateway.models.push(model);
      return model;
    },
  };
});

function summaryInput(): BriefSummaryInput {
  return {
    cadence: "daily",
    items: [
      {
        kind: "due_followup",
        personDisplayName: "Mark",
        title: "Follow up with Mark",
        reason: "Reconnect.",
      },
    ],
  };
}

describe("createDefaultBriefSummaryAdapter", () => {
  it("uses the deterministic summary when AI Gateway credentials are unavailable", async () => {
    fakeGateway.models.length = 0;
    const adapter = createDefaultBriefSummaryAdapter({});

    const result = await adapter(summaryInput());
    expect(result?.provenance).toEqual({
      generator: "deterministic",
      version: DETERMINISTIC_BRIEF_SUMMARY_VERSION,
    });
    expect(fakeGateway.models).toEqual([]);
  });

  it("calls the model through the entry point when credentials are present", async () => {
    fakeGateway.models.length = 0;
    const adapter = createDefaultBriefSummaryAdapter({
      AI_GATEWAY_API_KEY: "test-key",
      TENDNOTE_BRIEF_SUMMARY_MODEL: "google/gemini-test",
    });

    const result = await adapter(summaryInput());
    expect(result?.summary).toBe("LLM-written brief summary.");
    expect(result?.provenance).toEqual({ generator: "llm", version: "llm:google/gemini-test" });
    expect(fakeGateway.models.map((m) => m.modelId)).toEqual(["google/gemini-test"]);
    const calls = fakeGateway.models.flatMap((m) => m.doGenerateCalls);
    expect(calls.map((c) => c.providerOptions)).toEqual([
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
});
