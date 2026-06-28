import { type BriefSummaryInput, DETERMINISTIC_BRIEF_SUMMARY_VERSION } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { createDefaultBriefSummaryAdapter } from "../briefs";

const aiMock = vi.hoisted(() => ({
  gateway: vi.fn((modelId: string) => ({ modelId })),
  generateText: vi.fn(async () => ({ text: "LLM-written brief summary." })),
}));

vi.mock("ai", () => aiMock);

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
    expect(aiMock.generateText).not.toHaveBeenCalled();
  });

  it("calls the gateway model when credentials are present", async () => {
    aiMock.generateText.mockClear();
    aiMock.gateway.mockClear();
    const adapter = createDefaultBriefSummaryAdapter({
      AI_GATEWAY_API_KEY: "test-key",
      TENDNOTE_BRIEF_SUMMARY_MODEL: "anthropic/claude-test",
    });

    const result = await adapter(summaryInput());
    expect(result?.summary).toBe("LLM-written brief summary.");
    expect(result?.provenance).toEqual({ generator: "llm", version: "llm:anthropic/claude-test" });
    expect(aiMock.gateway).toHaveBeenCalledWith("anthropic/claude-test");
    expect(aiMock.generateText).toHaveBeenCalledTimes(1);
  });
});
