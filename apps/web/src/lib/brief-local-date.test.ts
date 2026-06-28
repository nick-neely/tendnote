import { describe, expect, it } from "vitest";
import { currentLocalDate } from "./brief-local-date";

describe("currentLocalDate", () => {
  it("formats a date as zero-padded YYYY-MM-DD in local components", () => {
    expect(currentLocalDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(currentLocalDate(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
  });
});
