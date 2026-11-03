import { describe, expect, it } from "vitest";
import { BACKGROUND_PASS_CRON, BACKGROUND_PASS_INTERVAL_MS } from "./background-pass";
import { FIRST_VALUE_POLICY } from "./first-value-daily";
import { FIRST_VALUE_INTERVAL_MS } from "./first-value-health";

/**
 * The interval a cron string of the two shapes this cadence uses runs at:
 * `M * * * *` (hourly) or `*\/N * * * *` (every N minutes, N dividing 60).
 */
function intervalOf(cron: string): number | null {
  if (/^[0-5]?\d \* \* \* \*$/.test(cron)) return 60 * 60 * 1000;
  const minutes = Number(cron.match(/^\*\/(\d{1,2}) \* \* \* \*$/)?.[1]);
  return minutes > 0 && 60 % minutes === 0 ? minutes * 60 * 1000 : null;
}

describe("background pass cadence", () => {
  it("describes the interval its cron string runs at", () => {
    expect(intervalOf(BACKGROUND_PASS_CRON)).toBe(BACKGROUND_PASS_INTERVAL_MS);
  });

  it("reads the hourly and every-N-minutes shapes, and nothing else", () => {
    expect(intervalOf("0 * * * *")).toBe(60 * 60 * 1000);
    expect(intervalOf("*/10 * * * *")).toBe(10 * 60 * 1000);
    expect(intervalOf("*/7 * * * *")).toBeNull();
    expect(intervalOf("0 */2 * * *")).toBeNull();
    expect(intervalOf("0 0 * * *")).toBeNull();
    expect(intervalOf("75 * * * *")).toBeNull();
  });

  it("keeps ten-minute passes whenever First Value samples every ten minutes", () => {
    // ADR 0265's slot state machine needs a sample every ten minutes; restoring
    // that policy without restoring the cadence would read every gap as a miss.
    if (FIRST_VALUE_POLICY === "ten_minute") {
      expect(BACKGROUND_PASS_INTERVAL_MS).toBe(FIRST_VALUE_INTERVAL_MS);
    } else {
      expect(BACKGROUND_PASS_INTERVAL_MS).toBeGreaterThanOrEqual(FIRST_VALUE_INTERVAL_MS);
    }
  });
});
