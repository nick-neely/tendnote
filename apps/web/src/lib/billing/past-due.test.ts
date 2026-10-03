import { describe, expect, it } from "vitest";
import { pastDueNotice } from "./past-due";

const FAILED = new Date("2026-11-01T10:30:00Z");
const at = (iso: string) => new Date(iso);

describe("the Past Due notice's days remaining (#610)", () => {
  it("counts down the seven days to the date the window closes", () => {
    expect(pastDueNotice(FAILED, FAILED)).toEqual({
      headline: "Your renewal payment didn't go through.",
      detail:
        "Full access continues for 7 more days. Update your card by November 8, 2026 to keep it.",
    });
    expect(pastDueNotice(FAILED, at("2026-11-04T10:30:00Z")).detail).toMatch(/for 4 more days/);
  });

  it("counts a part day as a day left, and says so in the singular", () => {
    expect(pastDueNotice(FAILED, at("2026-11-08T10:29:00Z")).detail).toMatch(/for 1 more day\./);
  });

  it("says access ends today once the window has closed but the account has not yet lapsed", () => {
    expect(pastDueNotice(FAILED, at("2026-11-08T10:35:00Z")).detail).toMatch(
      /^Full access ends today\. Update your card by November 8, 2026/,
    );
  });
});
