import { describe, expect, it } from "vitest";
import { defaultRailTab } from "./rail-tabs";

describe("defaultRailTab", () => {
  it("opens on Today whenever Today holds something", () => {
    expect(defaultRailTab({ today: 1, followups: 5, review: 6 })).toBe("today");
    expect(defaultRailTab({ today: 1, followups: 0, review: 0 })).toBe("today");
  });

  /**
   * The failure this exists to prevent: an owner with five near reminders and six
   * things to review landing on an empty Today and having to go looking.
   */
  it("falls through to the first panel that does hold something", () => {
    expect(defaultRailTab({ today: 0, followups: 5, review: 6 })).toBe("followups");
    expect(defaultRailTab({ today: 0, followups: 0, review: 6 })).toBe("review");
  });

  /** Nothing waiting anywhere is not a failure; Today is where capture lives. */
  it("returns to Today when no panel holds anything", () => {
    expect(defaultRailTab({ today: 0, followups: 0, review: 0 })).toBe("today");
  });
});
