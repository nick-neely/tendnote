import { describe, expect, it } from "vitest";
import { interactiveFallbackModelId } from "../agent/lib/fallback-model";

describe("interactive Eve's Fallback Model", () => {
  it("is GPT-6 Luna by default", () => {
    expect(interactiveFallbackModelId(undefined)).toBe("openai/gpt-6-luna");
    expect(interactiveFallbackModelId(" ")).toBe("openai/gpt-6-luna");
  });

  it("can be set to the named alternate without a new decision", () => {
    expect(interactiveFallbackModelId("google/gemini-3.1-flash-lite")).toBe(
      "google/gemini-3.1-flash-lite",
    );
  });

  it("refuses any model the decision did not name", () => {
    expect(() => interactiveFallbackModelId("google/gemini-3.7-flash")).toThrow(
      /TENDNOTE_FALLBACK_MODEL/,
    );
    expect(() => interactiveFallbackModelId("zai/glm-5.3-flash")).toThrow(
      /openai\/gpt-6-luna or google\/gemini-3.1-flash-lite/,
    );
  });
});
