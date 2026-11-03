import { BACKGROUND_PASS_INTERVAL_MS } from "@tendnote/domain/background-pass";
import { describe, expect, it } from "vitest";
import { LATE_REMINDER_LOOKBACK_MS } from "./reliability-indicators";

describe("reminder lateness lookback", () => {
  it("sees a reminder resolved late at any point since the previous pass", () => {
    // A late acceptance just after one pass must still be inside the window when
    // the next pass reads it, with room for that pass's own start jitter.
    expect(LATE_REMINDER_LOOKBACK_MS).toBeGreaterThan(BACKGROUND_PASS_INTERVAL_MS);
  });

  it("clears within about one pass after reminders are on time again", () => {
    expect(LATE_REMINDER_LOOKBACK_MS).toBeLessThan(2 * BACKGROUND_PASS_INTERVAL_MS);
  });
});
