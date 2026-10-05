import { describe, expect, it } from "vitest";
import { suspensionReviewDeadline } from "./temporary-suspension";

describe("suspensionReviewDeadline (#629)", () => {
  it("is ten business days later at the same UTC time, skipping weekends", () => {
    // Monday to the Monday two weeks on.
    expect(suspensionReviewDeadline(new Date("2026-10-05T09:15:00.000Z"))).toEqual(
      new Date("2026-10-19T09:15:00.000Z"),
    );
    // Friday to the Friday two weeks on.
    expect(suspensionReviewDeadline(new Date("2026-10-09T23:59:00.000Z"))).toEqual(
      new Date("2026-10-23T23:59:00.000Z"),
    );
  });

  it("counts a weekend start from the following Monday", () => {
    expect(suspensionReviewDeadline(new Date("2026-10-04T12:00:00.000Z"))).toEqual(
      new Date("2026-10-16T12:00:00.000Z"),
    );
  });
});
