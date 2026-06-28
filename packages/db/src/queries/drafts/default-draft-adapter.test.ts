import type { DraftGroundedContext } from "@tendnote/domain";
import { describe, expect, it, vi } from "vitest";
import { createDefaultDraftAdapter } from "../drafts";

const aiMock = vi.hoisted(() => ({
  gateway: vi.fn((modelId: string) => ({ modelId })),
  generateText: vi.fn(async () => ({ text: "LLM-written draft body." })),
}));

vi.mock("ai", () => aiMock);

function grounded(): DraftGroundedContext {
  return {
    person: { displayName: "Mark", relationshipType: "friend" },
    channel: "text",
    purpose: "check_in",
    facts: ["Just moved to Denver"],
    loggedContext: [],
    tentative: [],
  };
}

describe("createDefaultDraftAdapter", () => {
  it("uses the deterministic, source-grounded draft when no gateway credentials exist", async () => {
    // This is the standard-verification path: no network, no live model.
    const adapter = createDefaultDraftAdapter({});

    const result = await adapter(grounded());

    expect(result.provenance.generator).toBe("deterministic");
    expect(result.body.toLowerCase()).toContain("denver");
    expect(aiMock.generateText).not.toHaveBeenCalled();
  });

  it("calls the gateway model when credentials are present (credential-gated live path)", async () => {
    aiMock.generateText.mockClear();
    aiMock.gateway.mockClear();
    const adapter = createDefaultDraftAdapter({
      AI_GATEWAY_API_KEY: "test-key",
      TENDNOTE_DRAFT_MODEL: "anthropic/claude-test",
    });

    const result = await adapter(grounded());

    expect(result.body).toBe("LLM-written draft body.");
    expect(result.provenance).toEqual({ generator: "llm", version: "llm:anthropic/claude-test" });
    expect(aiMock.gateway).toHaveBeenCalledWith("anthropic/claude-test");
    expect(aiMock.generateText).toHaveBeenCalledTimes(1);
  });

  it("falls back to the deterministic draft when the model returns empty text", async () => {
    aiMock.generateText.mockResolvedValueOnce({ text: "   " });
    const adapter = createDefaultDraftAdapter({ AI_GATEWAY_API_KEY: "test-key" });

    const result = await adapter(grounded());

    expect(result.provenance.generator).toBe("deterministic");
    expect(result.body.toLowerCase()).toContain("denver");
  });
});
