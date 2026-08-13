import { describe, expect, it } from "vitest";
import {
  isReminderRecordEligible,
  nextBirthdayFollowupDueAt,
  reminderTimeSemanticsForRecordKind,
} from "./reminders";

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

describe("Reminder record policy", () => {
  it("owns time semantics for every Reminder record kind", () => {
    expect(reminderTimeSemanticsForRecordKind("general_action")).toBe("date_only");
    expect(reminderTimeSemanticsForRecordKind("follow_up")).toBe("date_only");
    expect(reminderTimeSemanticsForRecordKind("routine")).toBe("date_only");
    expect(reminderTimeSemanticsForRecordKind("saved_item")).toBe("instant");
  });

  it("applies eligibility consistently for client and server callers", () => {
    const base = {
      occursAt: new Date("2026-08-01T15:00:00.000Z"),
      recurrence: null,
      sensitivity: "normal" as const,
    };
    expect(isReminderRecordEligible({ ...base, kind: "general_action", status: "open" })).toBe(
      true,
    );
    expect(isReminderRecordEligible({ ...base, kind: "general_action", status: "deferred" })).toBe(
      true,
    );
    expect(isReminderRecordEligible({ ...base, kind: "general_action", status: "completed" })).toBe(
      false,
    );
    expect(isReminderRecordEligible({ ...base, kind: "saved_item", status: "active" })).toBe(true);
    expect(isReminderRecordEligible({ ...base, kind: "saved_item", status: "archived" })).toBe(
      false,
    );
    expect(
      isReminderRecordEligible({ ...base, kind: "routine", status: "open", recurrence: {} }),
    ).toBe(true);
    expect(
      isReminderRecordEligible({ ...base, kind: "routine", status: "deferred", recurrence: {} }),
    ).toBe(false);
  });
});
