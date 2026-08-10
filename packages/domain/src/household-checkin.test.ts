import { describe, expect, it } from "vitest";
import {
  composeHouseholdCheckin,
  HOUSEHOLD_CHECKIN_MAX_RECORDS,
  householdCheckinIsWorthShowing,
} from "./household-checkin";
import type { HouseholdHomeRecord } from "./household-home";

const NOW = new Date("2026-07-21T09:00:00.000Z");

function record(overrides: Partial<HouseholdHomeRecord> = {}): HouseholdHomeRecord {
  return {
    identity: "action:a1",
    family: "action",
    section: "coming_up",
    pressing: false,
    record: { kind: "general_action", id: "a1", href: "/actions#a1" },
    title: "Put the bins out",
    context: "Action",
    timing: { code: "scheduled", explanation: "Due Tuesday" },
    scopeLabel: "Household",
    responsibility: null,
    progress: null,
    at: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

function hours(count: number): Date {
  return new Date(NOW.getTime() + count * 60 * 60 * 1_000);
}

describe("composeHouseholdCheckin", () => {
  it("keeps at most three, however many are eligible", () => {
    const composition = composeHouseholdCheckin({
      records: [0, 1, 2, 3, 4].map((index) =>
        record({ identity: `action:a${index}`, at: hours(index) }),
      ),
    });

    expect(composition.records).toHaveLength(HOUSEHOLD_CHECKIN_MAX_RECORDS);
    expect(composition.records.map((entry) => entry.identity)).toEqual([
      "action:a0",
      "action:a1",
      "action:a2",
    ]);
  });

  it("puts what is already asking something of the household ahead of what is merely nearer", () => {
    const composition = composeHouseholdCheckin({
      records: [
        record({ identity: "action:soon", at: hours(1) }),
        record({ identity: "action:pressing", pressing: true, at: hours(9) }),
      ],
    });

    expect(composition.records.map((entry) => entry.identity)).toEqual([
      "action:pressing",
      "action:soon",
    ]);
  });

  it("is stable for the same state, so a re-read never reads as activity", () => {
    const tied = [
      record({ identity: "action:b" }),
      record({ identity: "action:a" }),
      record({ identity: "action:c" }),
    ];

    const first = composeHouseholdCheckin({ records: tied });
    const second = composeHouseholdCheckin({ records: [...tied].reverse() });

    expect(second.records.map((entry) => entry.identity)).toEqual(
      first.records.map((entry) => entry.identity),
    );
  });

  it("never lists one record twice, whichever family offered it", () => {
    const composition = composeHouseholdCheckin({
      records: [record(), record(), record()],
    });

    expect(composition.records).toHaveLength(1);
  });
});

describe("householdCheckinIsWorthShowing", () => {
  it("omits the entry entirely when there is nothing timely", () => {
    // Not an empty card: an empty Check-in is a standing request to go and find
    // something, which is a task the household never agreed to.
    expect(householdCheckinIsWorthShowing(composeHouseholdCheckin({ records: [] }))).toBe(false);
  });

  it("still shows when a family could not be read", () => {
    // "We could not look" is something the member needs to know, and it must not
    // be silently indistinguishable from "nothing is going on".
    expect(
      householdCheckinIsWorthShowing(
        composeHouseholdCheckin({ records: [], limitations: ["unavailable"] }),
      ),
    ).toBe(true);
  });
});
