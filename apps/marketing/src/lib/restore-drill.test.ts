import { describe, expect, it } from "vitest";
import { isRestoreDrillCurrent } from "./restore-drill";

const now = new Date("2026-10-02T12:00:00Z");

describe("the recovery sentence", () => {
  it("stays off the site until a drill has passed", () => {
    expect(isRestoreDrillCurrent(null, now)).toBe(false);
  });

  it("is published for six months after a passed drill", () => {
    expect(isRestoreDrillCurrent("2026-09-15", now)).toBe(true);
    expect(isRestoreDrillCurrent("2026-04-03", now)).toBe(true);
  });

  it("is withdrawn once the drill is overdue", () => {
    expect(isRestoreDrillCurrent("2026-04-01", now)).toBe(false);
  });

  it("refuses a malformed or future date rather than publishing", () => {
    expect(isRestoreDrillCurrent("soon", now)).toBe(false);
    expect(isRestoreDrillCurrent("2026-12-01", now)).toBe(false);
  });
});
