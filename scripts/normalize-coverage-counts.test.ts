import { describe, expect, it } from "vitest";
import { normalizeCoverageCounts } from "./normalize-coverage-counts.mjs";

describe("V8 coverage count normalization", () => {
  it("clamps impossible negative counters without inventing covered executions", () => {
    const coverage = {
      "/repo/example.ts": {
        s: { "0": 3, "1": -2 },
        f: { "0": -1, "1": 4 },
        b: { "0": [2, -9], "1": [0, 1] },
      },
    };

    expect(normalizeCoverageCounts(coverage)).toEqual({
      coverage: {
        "/repo/example.ts": {
          s: { "0": 3, "1": 0 },
          f: { "0": 0, "1": 4 },
          b: { "0": [2, 0], "1": [0, 1] },
        },
      },
      normalizedCount: 3,
    });
  });
});
