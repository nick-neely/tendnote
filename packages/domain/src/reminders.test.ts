import { describe, expect, it } from "vitest";
import {
  formatReminderChoiceLabel,
  formatReminderScheduleLabel,
  isReminderRecordEligible,
  nextBirthdayFollowupDueAt,
  reminderTimeSemanticsForRecordKind,
  resolveReminderIntendedAt,
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

  it("renders arbitrary lead times instead of claiming the occurrence time", () => {
    expect(formatReminderChoiceLabel({ kind: "relative", leadMinutes: 123 }, "date_only")).toBe(
      "2 hours 3 minutes before at 9:00 AM",
    );

    const label = formatReminderScheduleLabel({
      kind: "relative",
      localTime: null,
      leadMinutes: 123,
      timeZone: "America/Chicago",
      intendedAt: new Date("2026-08-16T11:57:00.000Z"),
    });
    expect(label).toContain("2026-08-16");
    expect(label).toContain("2 hours 3 minutes before");
    expect(label).not.toContain("occurrence time");
  });

  it("keeps legacy callers permissive while Eve can request strict wall-time validation", () => {
    const input = {
      occursAt: new Date("2026-03-08T00:00:00.000Z"),
      timeSemantics: "date_only" as const,
      timeZone: "America/New_York",
      choice: { kind: "exact" as const, localTime: "02:30" },
    };
    expect(resolveReminderIntendedAt(input)).toEqual(new Date("2026-03-08T07:30:00.000Z"));
    expect(() => resolveReminderIntendedAt({ ...input, wallTimeMode: "strict" })).toThrow(
      /does not exist/i,
    );
  });
});
