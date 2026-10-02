import type { DraftGroundedContext } from "@tendnote/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultDraftAdapter } from "../drafts";

// The real AI SDK runs against a fake gateway, so the test sees the request the
// model-call entry point actually sends.
const fakeGateway = vi.hoisted(async () => {
  const { fakeGatewayProvider } = await import("../model-call-fixtures");
  return fakeGatewayProvider("LLM-written draft body.");
});

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  gateway: (await fakeGateway).provider,
}));

const recordModelUsage = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../usage-ledger", () => ({ recordModelUsage }));

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

beforeEach(async () => {
  (await fakeGateway).reset();
});

describe("createDefaultDraftAdapter", () => {
  it("uses the deterministic, source-grounded draft when no gateway credentials exist", async () => {
    // This is the standard-verification path: no network, no live model.
    const adapter = createDefaultDraftAdapter({});

    const result = await adapter(grounded(), { accountId: "owner-1" });

    expect(result.provenance.generator).toBe("deterministic");
    expect(result.body.toLowerCase()).toContain("denver");
    expect((await fakeGateway).models).toEqual([]);
  });

  it("calls the model through the entry point when credentials are present", async () => {
    const adapter = createDefaultDraftAdapter({
      AI_GATEWAY_API_KEY: "test-key",
      TENDNOTE_DRAFT_MODEL: "google/gemini-test",
    });

    const result = await adapter(grounded(), { accountId: "owner-1" });

    expect(result.body).toBe("LLM-written draft body.");
    expect(result.provenance).toEqual({ generator: "llm", version: "llm:google/gemini-test" });
    const { models, sentProviderOptions } = await fakeGateway;
    expect(models.map((m) => m.modelId)).toEqual(["google/gemini-test"]);
    expect(recordModelUsage).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "owner-1", costCategory: "background" }),
    );
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

  it("falls back to the deterministic draft when the model returns empty text", async () => {
    (await fakeGateway).respondWith("   ");
    const adapter = createDefaultDraftAdapter({ AI_GATEWAY_API_KEY: "test-key" });

    const result = await adapter(grounded(), { accountId: "owner-1" });

    expect(result.provenance.generator).toBe("deterministic");
    expect(result.body.toLowerCase()).toContain("denver");
  });
});
