import { type BriefSummaryInput, DETERMINISTIC_BRIEF_SUMMARY_VERSION } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { createDefaultBriefSummaryAdapter } from "../briefs";

// The real AI SDK runs against a fake gateway, so the test sees the request the
// model-call entry point actually sends.
const fakeGateway = vi.hoisted(async () => {
  const { fakeGatewayProvider } = await import("../model-call-fixtures");
  return fakeGatewayProvider("LLM-written brief summary.");
});

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  gateway: (await fakeGateway).provider,
}));

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
    const adapter = createDefaultBriefSummaryAdapter({});

    const result = await adapter(summaryInput());
    expect(result?.provenance).toEqual({
      generator: "deterministic",
      version: DETERMINISTIC_BRIEF_SUMMARY_VERSION,
    });
    expect((await fakeGateway).models).toEqual([]);
  });

  it("calls the model through the entry point when credentials are present", async () => {
    const adapter = createDefaultBriefSummaryAdapter({
      AI_GATEWAY_API_KEY: "test-key",
      TENDNOTE_BRIEF_SUMMARY_MODEL: "google/gemini-test",
    });

    const result = await adapter(summaryInput());
    expect(result?.summary).toBe("LLM-written brief summary.");
    expect(result?.provenance).toEqual({ generator: "llm", version: "llm:google/gemini-test" });
    const { models, sentProviderOptions } = await fakeGateway;
    expect(models.map((m) => m.modelId)).toEqual(["google/gemini-test"]);
    expect(sentProviderOptions()).toEqual([
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
