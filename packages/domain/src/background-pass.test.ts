import { describe, expect, it } from "vitest";
import {
  BACKGROUND_PASS_CRON,
  BACKGROUND_PASS_INTERVAL_MS,
  backgroundPassIntervalMs,
} from "./background-pass";
import { FIRST_VALUE_POLICY } from "./first-value-daily";
import { FIRST_VALUE_INTERVAL_MS } from "./first-value-health";

describe("background pass cadence", () => {
  it("describes the interval its cron string runs at", () => {
    expect(backgroundPassIntervalMs(BACKGROUND_PASS_CRON)).toBe(BACKGROUND_PASS_INTERVAL_MS);
  });

  it("reads the hourly and every-N-minutes shapes, and nothing else", () => {
    expect(backgroundPassIntervalMs("0 * * * *")).toBe(60 * 60 * 1000);
    expect(backgroundPassIntervalMs("*/10 * * * *")).toBe(10 * 60 * 1000);
    expect(backgroundPassIntervalMs("*/7 * * * *")).toBeNull();
    expect(backgroundPassIntervalMs("0 */2 * * *")).toBeNull();
    expect(backgroundPassIntervalMs("0 0 * * *")).toBeNull();
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
