import { describe, expect, it } from "vitest";
import {
  createAiSdkContextFactExtractionAdapter,
  createDefaultContextFactExtractionAdapter,
  hasContextFactExtractionCredentials,
  shouldRunLiveContextFactExtractionQualityEval,
} from "./ai-sdk-adapter";

describe("Context Fact extraction model adapter", () => {
  it("keeps model evaluation explicitly opt-in and credential-gated", () => {
    expect(hasContextFactExtractionCredentials({})).toBe(false);
    expect(hasContextFactExtractionCredentials({ AI_GATEWAY_API_KEY: "test" })).toBe(true);
    expect(shouldRunLiveContextFactExtractionQualityEval({})).toBe(false);
    expect(
      shouldRunLiveContextFactExtractionQualityEval({
        AI_GATEWAY_API_KEY: "test",
        TENDNOTE_RUN_LIVE_CONTEXT_FACT_EVAL: "1",
      }),
    ).toBe(true);
  });

  it("does not call a provider without credentials", async () => {
    const adapter = createAiSdkContextFactExtractionAdapter({ env: {} });
    await expect(adapter.extractCandidates({ message: "I work in Chicago." })).rejects.toThrow(
      "Missing AI Gateway credentials",
    );
  });

  it("defaults to the explicit context-fact prompt family", () => {
    const adapter = createDefaultContextFactExtractionAdapter({});
    expect(adapter).toMatchObject({ kind: "llm", promptVersion: "context-fact-extraction.v1" });
  });
});
