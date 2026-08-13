import { describe, expect, it } from "vitest";
import {
  composeHouseholdHome,
  type HouseholdCoordinationRecord,
  type HouseholdHomeRecord,
  type HouseholdHomeSection,
  householdRecordScopeLabel,
} from "./household-home";

const CREATED_AT = new Date("2026-06-01T00:00:00.000Z");

function record(
  id: string,
  overrides: Omit<Partial<HouseholdCoordinationRecord>, "at" | "section"> & {
    section: HouseholdHomeSection;
    at: string;
  },
): HouseholdCoordinationRecord {
  const { at, ...rest } = overrides;
  return {
    identity: `action:${id}`,
    family: "action",
    pressing: overrides.section === "needs_attention",
    record: { kind: "general_action", id, href: `/actions#action-${id}` },
    title: `Record ${id}`,
    context: "Action",
    timing: { code: "due_today", explanation: "Due today." },
    scopeLabel: "Household",
    responsibility: null,
    progress: { kind: "complete_record", label: "Done", expectedOccurrenceVersion: 0 },
    createdAt: CREATED_AT,
    ...rest,
    at: new Date(at),
  };
}

function identities(records: readonly HouseholdHomeRecord[]): string[] {
  return records.map((entry) => entry.identity);
}

describe("composeHouseholdHome", () => {
  it("splits the household's records into the two sections it has", () => {
    const composition = composeHouseholdHome({
      records: [
        record("a", { section: "needs_attention", at: "2026-07-20T09:00:00.000Z" }),
        record("b", { section: "coming_up", at: "2026-07-28T09:00:00.000Z", pressing: false }),
      ],
    });

    expect(composition.needsAttention.heading).toBe("Ready now");
    expect(identities(composition.needsAttention.records)).toEqual(["action:a"]);
    expect(composition.comingUp.heading).toBe("Coming up");
    expect(identities(composition.comingUp.records)).toEqual(["action:b"]);
  });

  it("keeps caller-scoped Gift Plans out of the shared home", () => {
    const composition = composeHouseholdHome({
      records: [
        record("plan", {
          identity: "gift_plan:plan",
          family: "gift_plan",
          section: "coming_up",
          at: "2026-07-28T09:00:00.000Z",
          pressing: false,
          record: { kind: "gift_plan", id: "plan", href: "/gift-plans/plan" },
          context: "Gift plan",
          progress: null,
        }),
      ],
    });

    expect(composition.needsAttention.records).toEqual([]);
    expect(composition.comingUp.records).toEqual([]);
  });

  it("orders every section by time, then by identity, so two members see one order", () => {
    const sameInstant = "2026-07-22T09:00:00.000Z";
    const records = [
      record("later", { section: "coming_up", at: "2026-07-30T09:00:00.000Z", pressing: false }),
      record("zulu", {
        section: "coming_up",
        at: sameInstant,
        pressing: false,
        identity: "action:zulu",
      }),
      record("alpha", {
        section: "coming_up",
        at: sameInstant,
        pressing: false,
        identity: "action:alpha",
      }),
    ];

    const forward = composeHouseholdHome({ records });
    const reversed = composeHouseholdHome({ records: [...records].reverse() });

    expect(identities(forward.comingUp.records)).toEqual([
      "action:alpha",
      "action:zulu",
      "action:later",
    ]);
    expect(identities(reversed.comingUp.records)).toEqual(identities(forward.comingUp.records));
  });

  it("normally shows three records and points at the domain for the rest", () => {
    const composition = composeHouseholdHome({
      records: ["a", "b", "c", "d", "e"].map((id, index) =>
        record(id, {
          section: "coming_up",
          at: `2026-07-2${index + 1}T09:00:00.000Z`,
          pressing: false,
        }),
      ),
    });

    expect(composition.comingUp.records).toHaveLength(3);
    expect(composition.comingUp.more).toEqual({
      destinations: [{ family: "action", label: "Actions", href: "/actions" }],
    });
  });

  it("lets pressing records fill the section to five rather than hide one behind a link", () => {
    const composition = composeHouseholdHome({
      records: ["a", "b", "c", "d"].map((id, index) =>
        record(id, { section: "needs_attention", at: `2026-07-1${index + 1}T09:00:00.000Z` }),
      ),
    });

    expect(composition.needsAttention.records).toHaveLength(4);
    expect(composition.needsAttention.more).toBeNull();
  });

  it("never shows more than five, however much is waiting", () => {
    const composition = composeHouseholdHome({
      records: ["a", "b", "c", "d", "e", "f", "g"].map((id, index) =>
        record(id, { section: "needs_attention", at: `2026-07-0${index + 1}T09:00:00.000Z` }),
      ),
    });

    expect(composition.needsAttention.records).toHaveLength(5);
    expect(composition.needsAttention.more).not.toBeNull();
  });

  it("keeps a pressing record and gives the remaining room to the rest", () => {
    const composition = composeHouseholdHome({
      records: [
        record("resurfaced-1", {
          section: "needs_attention",
          at: "2026-07-20T09:00:00.000Z",
          pressing: false,
          timing: { code: "resurfaced", explanation: "Set to return 20 July." },
        }),
        record("resurfaced-2", {
          section: "needs_attention",
          at: "2026-07-21T09:00:00.000Z",
          pressing: false,
          timing: { code: "resurfaced", explanation: "Set to return 21 July." },
        }),
        record("resurfaced-3", {
          section: "needs_attention",
          at: "2026-07-22T09:00:00.000Z",
          pressing: false,
          timing: { code: "resurfaced", explanation: "Set to return 22 July." },
        }),
        record("overdue", { section: "needs_attention", at: "2026-07-01T09:00:00.000Z" }),
      ],
    });

    expect(identities(composition.needsAttention.records)).toEqual([
      "action:overdue",
      "action:resurfaced-1",
      "action:resurfaced-2",
    ]);
  });

  it("reports where the rest is without reporting how much of it there is", () => {
    const composition = composeHouseholdHome({
      records: ["a", "b", "c", "d"].map((id, index) =>
        record(id, {
          section: "coming_up",
          at: `2026-07-2${index + 1}T09:00:00.000Z`,
          pressing: false,
        }),
      ),
    });

    expect(JSON.stringify(composition.comingUp.more)).not.toMatch(/count/i);
    expect(Object.keys(composition.comingUp.more ?? {})).toEqual(["destinations"]);
  });

  it("offers one link when Actions and Routines both overflow", () => {
    const composition = composeHouseholdHome({
      records: ["a", "b", "c", "d"].map((id, index) =>
        record(id, {
          section: "coming_up",
          at: `2026-07-2${index + 1}T09:00:00.000Z`,
          pressing: false,
          family: index % 2 === 0 ? "action" : "routine",
          identity: `${index % 2 === 0 ? "action" : "routine"}:${id}`,
        }),
      ),
    });

    expect(composition.comingUp.more?.destinations).toHaveLength(1);
  });

  it("keeps one entry per record when two families claim the same identity", () => {
    const composition = composeHouseholdHome({
      records: [
        record("a", { section: "coming_up", at: "2026-07-22T09:00:00.000Z", pressing: false }),
        record("a", { section: "coming_up", at: "2026-07-23T09:00:00.000Z", pressing: false }),
      ],
    });

    expect(composition.comingUp.records).toHaveLength(1);
  });

  it("carries a failed family's explanation into both sections without emptying either", () => {
    const composition = composeHouseholdHome({
      records: [record("a", { section: "needs_attention", at: "2026-07-20T09:00:00.000Z" })],
      limitations: [
        "Part of Household is temporarily unavailable.",
        "Part of Household is temporarily unavailable.",
      ],
    });

    expect(composition.needsAttention.records).toHaveLength(1);
    expect(composition.needsAttention.limitations).toEqual([
      "Part of Household is temporarily unavailable.",
    ]);
    expect(composition.comingUp.limitations).toEqual([
      "Part of Household is temporarily unavailable.",
    ]);
  });

  it("has nothing to read a member's private Today choice from", () => {
    // The composition input has no owner, no feedback, and no member id, so a
    // Not today cannot reach it even by mistake.
    expect(Object.keys(composeHouseholdHome({ records: [] }))).toEqual([
      "needsAttention",
      "comingUp",
    ]);
  });
});

describe("householdRecordScopeLabel", () => {
  it("credits a workspace-owned record to the household, never to whoever typed it", () => {
    expect(
      householdRecordScopeLabel({
        ownership: "household_native",
        ownerName: "Mara",
        isSelf: false,
      }),
    ).toBe("Household");
  });

  it("names the member who shared their own record", () => {
    expect(
      householdRecordScopeLabel({ ownership: "member_owned", ownerName: "Mara", isSelf: false }),
    ).toBe("Shared by Mara");
  });

  it("says so plainly when the record is the reader's own", () => {
    expect(
      householdRecordScopeLabel({ ownership: "member_owned", ownerName: "Nick", isSelf: true }),
    ).toBe("Shared by you");
  });

  it("stays factual when the name is unavailable", () => {
    expect(
      householdRecordScopeLabel({ ownership: "member_owned", ownerName: null, isSelf: false }),
    ).toBe("Shared by a household member");
  });
});
