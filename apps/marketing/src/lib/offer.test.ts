import { describe, expect, it } from "vitest";
import { approximateFullQualityTurns, FAIR_USE, formatDollars } from "./offer";

describe("published fair use", () => {
  it("converts the full-quality budget into the about-250-turns the offer decided", () => {
    expect(approximateFullQualityTurns()).toBe(250);
  });

  it("moves the published turn count when the measured per-turn cost moves", () => {
    expect(approximateFullQualityTurns(FAIR_USE.eveBudget, 0.061)).toBe(150);
    expect(approximateFullQualityTurns(FAIR_USE.eveBudget, 0.038)).toBe(300);
  });

  it("keeps the soft budget below the hard ceiling, with the gap left for the lighter model", () => {
    expect(FAIR_USE.eveBudget).toBeLessThan(FAIR_USE.eveCeiling);
  });

  it("prints whole and fractional dollars the way the page states them", () => {
    expect(formatDollars(12)).toBe("$12");
    expect(formatDollars(10.5)).toBe("$10.50");
  });
});
