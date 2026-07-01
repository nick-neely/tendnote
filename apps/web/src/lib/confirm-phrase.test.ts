import { describe, expect, it } from "vitest";
import { confirmPhraseMatches, generateConfirmPhrase } from "./confirm-phrase";

describe("generateConfirmPhrase", () => {
  it("joins the requested number of words with hyphens", () => {
    const phrase = generateConfirmPhrase(() => 0, 3);

    expect(phrase.split("-")).toHaveLength(3);
  });

  it("samples distinct words even when the rng keeps pointing at index 0", () => {
    // A fixed 0 always picks the current first word; without removal that would
    // repeat, so distinct output proves sampling is without replacement.
    const phrase = generateConfirmPhrase(() => 0, 3);
    const words = phrase.split("-");

    expect(new Set(words).size).toBe(words.length);
  });

  it("stays within the exclusive upper bound when the rng returns 1", () => {
    // A pathological rng returning exactly 1 must not index past the pool.
    expect(() => generateConfirmPhrase(() => 1, 3)).not.toThrow();
    expect(generateConfirmPhrase(() => 1, 3).split("-")).toHaveLength(3);
  });

  it("clamps the word count to the pool size so words remain distinct", () => {
    const phrase = generateConfirmPhrase(() => 0, 1000);
    const words = phrase.split("-");

    expect(words.length).toBeGreaterThan(0);
    expect(new Set(words).size).toBe(words.length);
  });
});

describe("confirmPhraseMatches", () => {
  it("accepts the exact phrase, ignoring surrounding space and case", () => {
    expect(confirmPhraseMatches("sage-wren-cove", "sage-wren-cove")).toBe(true);
    expect(confirmPhraseMatches("  SAGE-WREN-COVE  ", "sage-wren-cove")).toBe(true);
  });

  it("rejects anything that isn't the phrase", () => {
    expect(confirmPhraseMatches("sage-wren", "sage-wren-cove")).toBe(false);
    expect(confirmPhraseMatches("", "sage-wren-cove")).toBe(false);
  });
});
