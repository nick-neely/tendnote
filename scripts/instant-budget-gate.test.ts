import { describe, expect, it } from "vitest";
import {
  formatSamples,
  SAMPLE_CEILING_MULTIPLE,
  SHELL_BUDGET_MS,
  summariseSamples,
} from "../apps/web/tests/instant/support/measure";

/**
 * How the 100 ms contract is decided from a row's samples (#331).
 *
 * Tested from the root suite because `apps/web`'s Vitest config excludes
 * `tests/instant`, which is Playwright's; the same arrangement already covers
 * `engine-support.ts` in `instant-matrix-ci.test.ts`.
 *
 * The behaviour worth pinning is the *shape* of the gate, not the arithmetic.
 * `desktop critical navigation › person detail to Today` failed roughly one run
 * in three at 103.8 ms and 104.0 ms against 100 ms, on a two-vCPU runner, with
 * passes and failures interleaved across six commits — including the same commit
 * passing and then failing on a re-run. Every measured stage is stamped on an
 * animation frame, so a reading is a whole number of frames and one dropped
 * frame is the entire difference between 99 ms and 104 ms. The row already takes
 * four samples because "a single warm reading on a contended runner is not a
 * median"; the fix was to gate the median it was already collecting, not to move
 * the budget.
 */
describe("Instant navigation budget gate", () => {
  it("leaves the contract at 100 ms", () => {
    // The number is the product promise and #331 is not evidence against it.
    // If this ever changes, it should be because the promise changed.
    expect(SHELL_BUDGET_MS).toBe(100);
  });

  it("passes a row whose samples straddle the budget", () => {
    // The measured failure shape: three good samples and one a frame late.
    const summary = summariseSamples([26, 27, 104, 26]);

    expect(summary.median).toBeLessThanOrEqual(SHELL_BUDGET_MS);
    expect(summary.max).toBeLessThanOrEqual(SHELL_BUDGET_MS * SAMPLE_CEILING_MULTIPLE);
  });

  it("fails a row that genuinely sits on the budget", () => {
    // Half the samples over is a distribution centred at the budget, which is a
    // real breach of the contract rather than a dropped frame.
    expect(summariseSamples([104, 108, 26, 103]).median).toBeGreaterThan(SHELL_BUDGET_MS);
  });

  it("fails a single catastrophic sample however good the median is", () => {
    // The reading that made ADR 0210 pin `workers: 1`: this very row at 621 ms
    // under two-worker contention. The median alone would have forgiven it.
    const summary = summariseSamples([26, 27, 621, 26]);

    expect(summary.median).toBeLessThanOrEqual(SHELL_BUDGET_MS);
    expect(summary.max).toBeGreaterThan(SHELL_BUDGET_MS * SAMPLE_CEILING_MULTIPLE);
  });

  it("reports the samples behind the statistic, not just the statistic", () => {
    // A failure message that named only the median would send the next reader
    // back to the artifacts to find out whether it was one frame or all four.
    expect(formatSamples(summariseSamples([26, 27, 104, 26]))).toBe(
      "median 27ms of [26, 27, 104, 26]",
    );
  });

  it("refuses to gate a row that recorded nothing", () => {
    // Silently passing an empty row is how a harness that stopped measuring
    // reports success; ADR 0210's gates are only worth anything if absence is
    // louder than zero.
    expect(() => summariseSamples([])).toThrow(/nothing to gate/);
  });
});
