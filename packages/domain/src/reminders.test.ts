import { describe, expect, it } from "vitest";
import { nextBirthdayFollowupDueAt } from "./reminders";

describe("Birthday Follow-Up offer", () => {
  it("resolves the next local birthday occurrence without making the Birthday a reminder", () => {
    expect(
      nextBirthdayFollowupDueAt({
        birthday: "--03-01",
        now: new Date("2027-03-01T16:00:00.000Z"),
        timeZone: "America/Chicago",
      }),
    ).toEqual(new Date("2028-03-01T15:00:00.000Z"));
  });
});
