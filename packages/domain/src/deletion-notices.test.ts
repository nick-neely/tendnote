import { describe, expect, it } from "vitest";
import { lapsedRetentionDeadline } from "./access";
import { deletionNoticeDueForDeadlinesBy, dueDeletionNotice } from "./deletion-notices";

const DAY = 24 * 60 * 60 * 1000;
const lapsedAt = new Date("2026-01-01T12:00:00.000Z");
const deadline = lapsedRetentionDeadline(lapsedAt);
const day = (n: number) => new Date(lapsedAt.getTime() + n * DAY);

describe("dueDeletionNotice", () => {
  it("owes the first notice on entering Lapsed", () => {
    expect(dueDeletionNotice({ sent: null, deadline, now: lapsedAt })).toBe("day_0");
  });

  it("owes nothing more until day 60, then day 83", () => {
    expect(dueDeletionNotice({ sent: "day_0", deadline, now: day(59) })).toBeNull();
    expect(dueDeletionNotice({ sent: "day_0", deadline, now: day(60) })).toBe("day_60");
    expect(dueDeletionNotice({ sent: "day_60", deadline, now: day(82) })).toBeNull();
    expect(dueDeletionNotice({ sent: "day_60", deadline, now: day(83) })).toBe("day_83");
    expect(dueDeletionNotice({ sent: "day_83", deadline, now: day(89) })).toBeNull();
  });

  it("sends only the latest notice when the sweep fell behind", () => {
    expect(dueDeletionNotice({ sent: null, deadline, now: day(61) })).toBe("day_60");
    expect(dueDeletionNotice({ sent: "day_0", deadline, now: day(85) })).toBe("day_83");
  });

  it("owes no notice once the deadline has passed: the account is purged", () => {
    expect(dueDeletionNotice({ sent: null, deadline, now: day(90) })).toBeNull();
    expect(dueDeletionNotice({ sent: "day_60", deadline, now: day(91) })).toBeNull();
  });
});

describe("deletionNoticeDueForDeadlinesBy", () => {
  it("selects exactly the deadlines the per-account rule finds due", () => {
    expect(deletionNoticeDueForDeadlinesBy("day_60", day(60)).getTime()).toBe(deadline.getTime());
    expect(deletionNoticeDueForDeadlinesBy("day_83", day(83)).getTime()).toBe(deadline.getTime());
  });
});
