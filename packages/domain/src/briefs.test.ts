import { describe, expect, it } from "vitest";
import { resolveBriefItemTransition } from "./briefs";

describe("brief item transitions", () => {
  it("moves active items to dismissed, snoozed, and acted-on", () => {
    expect(resolveBriefItemTransition("active", "dismiss")).toBe("dismissed");
    expect(resolveBriefItemTransition("active", "snooze")).toBe("snoozed");
    expect(resolveBriefItemTransition("active", "act")).toBe("acted_on");
  });

  it("lets a snoozed item be dismissed or acted-on", () => {
    expect(resolveBriefItemTransition("snoozed", "dismiss")).toBe("dismissed");
    expect(resolveBriefItemTransition("snoozed", "act")).toBe("acted_on");
  });

  it("rejects invalid transitions out of terminal states", () => {
    expect(() => resolveBriefItemTransition("dismissed", "snooze")).toThrow(/dismissed/);
    expect(() => resolveBriefItemTransition("acted_on", "dismiss")).toThrow(/acted_on/);
  });
});
