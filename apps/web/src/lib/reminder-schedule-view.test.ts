import { describe, expect, it } from "vitest";
import { toReminderScheduleChoice } from "./reminder-schedule-view";

describe("toReminderScheduleChoice", () => {
  it("converts persisted exact and relative schedules through one helper", () => {
    expect(
      toReminderScheduleChoice({
        kind: "exact",
        localTime: "08:30",
        leadMinutes: null,
        timeZone: "America/Chicago",
        label: "Reminder",
      }),
    ).toEqual({ kind: "exact", localTime: "08:30" });
    expect(
      toReminderScheduleChoice({
        kind: "relative",
        localTime: null,
        leadMinutes: 60,
        timeZone: "America/Chicago",
        label: "Reminder",
      }),
    ).toEqual({ kind: "relative", leadMinutes: 60 });
  });
});
