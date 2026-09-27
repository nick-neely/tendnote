import { describe, expect, it } from "vitest";
import { FIRST_VALUE_STEPS, reachesFirstValue } from "./activation-milestones";

describe("First Value", () => {
  it("is reached once every step has happened", () => {
    expect(reachesFirstValue(FIRST_VALUE_STEPS)).toBe(true);
  });

  it("is not reached while any step is missing", () => {
    for (const missing of FIRST_VALUE_STEPS) {
      expect(reachesFirstValue(FIRST_VALUE_STEPS.filter((step) => step !== missing))).toBe(false);
    }
  });
});
