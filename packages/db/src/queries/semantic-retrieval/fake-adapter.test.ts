import { describe, expect, it } from "vitest";
import { fakeVectorForText } from "./fake-adapter";

function cosine(left: number[], right: number[]): number {
  const dot = left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
  return dot / ((Math.hypot(...left) || 1) * (Math.hypot(...right) || 1));
}

describe("offline fake embeddings", () => {
  it("is deterministic, normalized, and distributed across signed dimensions", () => {
    const first = fakeVectorForText("Refrigerator water filter EDR1RXD1");
    const second = fakeVectorForText("Refrigerator water filter EDR1RXD1");

    expect(first).toEqual(second);
    expect(first).toHaveLength(64);
    expect(first.some((value) => value < 0)).toBe(true);
    expect(first.some((value) => value > 0)).toBe(true);
    expect(Math.hypot(...first)).toBeCloseTo(1, 5);
  });

  it("separates unrelated text while keeping shared concepts close", () => {
    const filter = fakeVectorForText("refrigerator water filter replacement");
    const related = fakeVectorForText("replace the refrigerator filter");
    const unrelated = fakeVectorForText("boiler pressure inspection certificate");

    expect(cosine(filter, related)).toBeGreaterThan(0.45);
    expect(cosine(filter, unrelated)).toBeLessThan(0.45);
  });
});
