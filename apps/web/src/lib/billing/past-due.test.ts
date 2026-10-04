import { dunningExtensionExpiry, dunningWindowEnd } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { pastDueNotice } from "./past-due";

const FAILED = new Date("2026-11-01T10:30:00Z");
const WINDOW_CLOSES = dunningWindowEnd(FAILED);
const at = (iso: string) => new Date(iso);

describe("the Past Due notice's days remaining (#610)", () => {
  it("counts down the seven days of the window", () => {
    expect(pastDueNotice(WINDOW_CLOSES, FAILED)).toEqual({
      headline: "Your renewal payment didn't go through.",
      detail: "Full access continues for 7 more days. Update your card to keep it.",
    });
    expect(pastDueNotice(WINDOW_CLOSES, at("2026-11-04T10:30:00Z")).detail).toMatch(
      /for 4 more days/,
    );
  });

  it("counts only whole days left, so it never promises more than the window holds", () => {
    expect(pastDueNotice(WINDOW_CLOSES, at("2026-11-04T10:31:00Z")).detail).toMatch(
      /for 3 more days/,
    );
    expect(pastDueNotice(WINDOW_CLOSES, at("2026-11-07T10:30:00Z")).detail).toMatch(
      /for 1 more day\./,
    );
  });

  it("says access ends within a day under a day, and once the window has closed but not lapsed", () => {
    for (const now of ["2026-11-07T10:31:00Z", "2026-11-08T10:35:00Z"]) {
      expect(pastDueNotice(WINDOW_CLOSES, at(now)).detail).toBe(
        "Full access ends within a day. Update your card to keep it.",
      );
    }
  });

  it("counts down to a dunning extension's expiry instead of the seven days (#633)", () => {
    const extended = dunningWindowEnd(FAILED, dunningExtensionExpiry(FAILED, 5));

    expect(pastDueNotice(extended, at("2026-11-07T10:31:00Z")).detail).toMatch(/for 5 more days/);
    expect(pastDueNotice(extended, at("2026-11-12T10:30:00Z")).detail).toMatch(/for 1 more day\./);
  });
});
