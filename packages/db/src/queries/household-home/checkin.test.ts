import { HOUSEHOLD_CHECKIN_MAX_RECORDS } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createInMemoryGeneralActionLifecycleStore } from "../general-actions/in-memory-store";
import { createGeneralActionLifecycle } from "../general-actions/lifecycle";
import { createInMemoryGiftPlanStore } from "../gift-plans/in-memory-store";
import { createGiftPlanLifecycle } from "../gift-plans/lifecycle";
import { createHouseholdAuthorizationProver } from "../households/authorization";
import { removeHouseholdMember, seedHouseholdWithMembers } from "../households/household-fixtures";
import { loadHouseholdActionCandidates } from "./candidate-loaders/actions";
import { loadHouseholdCheckinGiftPlanCandidates } from "./candidate-loaders/gift-plans";
import { createHouseholdHomeService, type HouseholdHomeServiceDeps } from "./service";
import type { HouseholdCheckinView } from "./types";

/**
 * The Household Check-in over a real two-member household.
 *
 * The Check-in is the one household surface delivered *into a member's private
 * space*, so the properties worth proving are all about that boundary: that it
 * appears only for the member who asked, that it re-reads standing at the moment
 * it is composed rather than trusting whatever produced the entry, that it is
 * capped, and that a member who has lost access gets no trace of what they used
 * to be able to see.
 */
const OWNER = "user-owner";
const MEMBER = "user-member";
const OUTSIDER = "user-outsider";

const NOW = new Date("2026-07-21T15:00:00.000Z");
const LOCAL_DATE = "2026-07-21";

function days(count: number): Date {
  return new Date(NOW.getTime() + count * 24 * 60 * 60 * 1_000);
}

async function household(options: { optedIn?: readonly string[]; giftPlans?: boolean } = {}) {
  const optedIn = new Set(options.optedIn ?? [OWNER, MEMBER]);
  const store = createInMemoryGeneralActionLifecycleStore();
  const lifecycle = createGeneralActionLifecycle(store);
  const workspace = await seedHouseholdWithMembers(store, {
    ownerUserId: OWNER,
    name: "Ash Lane",
    members: [
      [OWNER, "owner"],
      [MEMBER, "member"],
    ],
  });
  const prover = createHouseholdAuthorizationProver(store);

  // The Gift Plan seam over the *same* household world as the Actions family, so
  // one membership roster answers both and a plan's household id is the household
  // the composition is actually reading.
  const giftPlans = createGiftPlanLifecycle({
    plans: createInMemoryGiftPlanStore(store),
    households: store,
  });

  const deps: HouseholdHomeServiceDeps = {
    readAdmittedHousehold: async ({ callerUserId }) => {
      const memberships = await store.listActiveHouseholdMembershipsForUser({
        userId: callerUserId,
      });
      const householdId = memberships[0]?.householdId;
      if (!householdId) return null;
      const found = await store.getHouseholdWorkspace({ householdId });
      return found && found.status === "active" ? { id: found.id, name: found.name } : null;
    },
    listMemberNames: async ({ callerUserId }) =>
      [
        { userId: OWNER, name: "Nick" },
        { userId: MEMBER, name: "Mara" },
      ].filter((member) => member.userId !== callerUserId),
    loadCandidateFamilies: [
      (input) =>
        loadHouseholdActionCandidates(
          {
            listVisibleActions: ({ callerUserId, limit }) =>
              lifecycle.listActiveGeneralActions({ ownerUserId: callerUserId, limit }),
          },
          input,
        ),
    ],
    proveRecords: (input) => prover.proveVisibleRecords(input),
    readCheckinOptIn: async ({ callerUserId }) => optedIn.has(callerUserId),
    // The Check-in's own family, wired exactly as production wires it: the seam's
    // proved read, then the composition's proof on top.
    loadCheckinOnlyFamilies: options.giftPlans
      ? [
          (input) =>
            loadHouseholdCheckinGiftPlanCandidates(
              {
                listVisibleGiftPlans: ({ callerUserId, limit }) =>
                  giftPlans.listGiftPlans({ callerUserId, limit }),
              },
              input,
            ),
        ]
      : [],
  };

  const service = createHouseholdHomeService(deps);

  const checkin = (callerUserId: string): Promise<HouseholdCheckinView> =>
    service.getHouseholdCheckin({ callerUserId, localDate: LOCAL_DATE, now: NOW });

  const seedChore = (overrides: { title: string; dueAt: Date | null }) =>
    lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: overrides.title,
      ownership: "household_native",
      householdId: workspace.id,
      dueAt: overrides.dueAt,
      recurrence: null,
      responsibilityHolderUserId: null,
    });

  const seedGiftPlan = (overrides: {
    subjectName?: string;
    occasion?: string;
    occasionOn: Date;
    surpriseSubjectUserId?: string | null;
  }) =>
    giftPlans.createGiftPlan({
      ownerUserId: OWNER,
      subjectName: overrides.subjectName ?? "Rowan",
      occasion: overrides.occasion ?? "Birthday",
      occasionOn: overrides.occasionOn,
      surpriseSubjectUserId: overrides.surpriseSubjectUserId ?? null,
      scope: "household",
      householdId: workspace.id,
    });

  return { store, lifecycle, workspace, service, checkin, seedChore, seedGiftPlan };
}

describe("the Household Check-in opt-in", () => {
  it("gives a member who has not asked for one nothing, and reads no household records", async () => {
    const { checkin, seedChore } = await household({ optedIn: [OWNER] });
    await seedChore({ title: "Put the bins out", dueAt: NOW });

    const view = await checkin(MEMBER);

    expect(view).toEqual({ household: null, optedIn: false, records: [], limitations: [] });
  });

  it("is one member's decision and never the other's", async () => {
    // Nobody enables a Check-in for anyone else, so two members of one household
    // with one opt-in between them get two different answers about the same
    // records (ADR 0220).
    const { checkin, seedChore } = await household({ optedIn: [OWNER] });
    await seedChore({ title: "Put the bins out", dueAt: NOW });

    expect((await checkin(OWNER)).records).toHaveLength(1);
    expect((await checkin(MEMBER)).records).toEqual([]);
  });
});

describe("the Household Check-in composition", () => {
  it("presents the household's timely records to an opted-in member", async () => {
    const { checkin, seedChore } = await household();
    await seedChore({ title: "Put the bins out", dueAt: NOW });

    const view = await checkin(MEMBER);

    expect(view.household).toMatchObject({ name: "Ash Lane" });
    expect(view.records.map((record) => record.title)).toEqual(["Put the bins out"]);
    // Every row is a canonical reference with its own type, provenance, and
    // timing in words — never generated household truth.
    expect(view.records[0]).toMatchObject({
      record: { kind: "general_action", href: expect.stringContaining("/actions") },
      scopeLabel: "Household",
      timing: { explanation: expect.any(String) },
    });
  });

  it("never presents more than three, however much the household has going on", async () => {
    const { checkin, seedChore } = await household();
    for (const index of [0, 1, 2, 3, 4]) {
      await seedChore({ title: `Chore ${index}`, dueAt: days(index) });
    }

    const view = await checkin(MEMBER);

    expect(view.records).toHaveLength(HOUSEHOLD_CHECKIN_MAX_RECORDS);
    // Soonest first, and no count of what was left out: a remaining number is a
    // backlog badge, and this list is not a backlog.
    expect(view.records.map((record) => record.title)).toEqual(["Chore 0", "Chore 1", "Chore 2"]);
    expect(JSON.stringify(view)).not.toMatch(/more|remaining|hidden/i);
  });

  it("orders identically for two members with the same access", async () => {
    // A Check-in is a caller-specific *delivery* of common records, not a
    // personalised ranking. Two members who can see the same things must be
    // shown the same things in the same order.
    const { checkin, seedChore } = await household();
    await seedChore({ title: "Water the plants", dueAt: days(2) });
    await seedChore({ title: "Put the bins out", dueAt: NOW });

    const owner = await checkin(OWNER);
    const member = await checkin(MEMBER);

    expect(member.records.map((record) => record.title)).toEqual(
      owner.records.map((record) => record.title),
    );
  });

  it("omits everything for a member whose access ended, leaving no trace of the household", async () => {
    const { checkin, seedChore, store, workspace } = await household();
    await seedChore({ title: "Put the bins out", dueAt: NOW });
    expect((await checkin(MEMBER)).records).toHaveLength(1);

    await removeHouseholdMember(store, { householdId: workspace.id, userId: MEMBER });

    const after = await checkin(MEMBER);
    expect(after.household).toBeNull();
    expect(after.records).toEqual([]);
    expect(after.limitations).toEqual([]);
  });

  it("gives a stranger nothing at all", async () => {
    const { checkin, seedChore } = await household({ optedIn: [OWNER, MEMBER, OUTSIDER] });
    await seedChore({ title: "Put the bins out", dueAt: NOW });

    const view = await checkin(OUTSIDER);

    expect(view.household).toBeNull();
    expect(view.records).toEqual([]);
  });

  it("composes an authorized Gift Plan as a planning reference, never a task", async () => {
    const { checkin, seedGiftPlan } = await household({ giftPlans: true });
    await seedGiftPlan({ occasionOn: days(4) });

    const view = await checkin(MEMBER);

    const plan = view.records.find((record) => record.family === "gift_plan");
    expect(plan).toBeDefined();
    expect(plan?.title).toBe("Rowan · Birthday");
    expect(plan?.record.href).toBe(`/gift-plans/${plan?.record.id}`);
    // A birthday is not a chore: no inline control, and never pressing.
    expect(plan?.progress).toBeNull();
    expect(plan?.pressing).toBe(false);
    // The audience shape, and no member named on it.
    expect(plan?.scopeLabel).toBe("Shared with you");
    expect(JSON.stringify(plan)).not.toContain(OWNER);
  });

  it("gives the Surprise Subject no plan, no count, and no gap where one was", async () => {
    // The exclusion at the newest surface, and the reason this test exists at all:
    // a family that reaches a caller-specific read is a family that has to be
    // refused caller by caller (ADR 0216).
    const { checkin, seedGiftPlan, seedChore } = await household({ giftPlans: true });
    await seedChore({ title: "Put the bins out", dueAt: NOW });
    await seedGiftPlan({ occasionOn: days(4), surpriseSubjectUserId: MEMBER });

    const owner = await checkin(OWNER);
    const subject = await checkin(MEMBER);

    // The owner sees their plan beside the household's chore.
    expect(owner.records.map((record) => record.family)).toContain("gift_plan");
    // The subject sees the chore and nothing else — not a placeholder, not a
    // shortened list they could measure, and no household-level count.
    expect(subject.records.map((record) => record.family)).toEqual(["action"]);
    expect(JSON.stringify(subject)).not.toMatch(/Rowan|gift/i);
  });

  it("keeps an undated or past plan off the check-in entirely", async () => {
    // "Timely" is the whole eligibility rule. An undated plan is not timely by
    // definition, and a birthday that has been and gone is not work anyone failed
    // to do — it drops out rather than reading as overdue.
    const { checkin, seedGiftPlan } = await household({ giftPlans: true });
    await seedGiftPlan({ subjectName: "Undated", occasion: "Someday", occasionOn: null as never });
    await seedGiftPlan({ subjectName: "Past", occasion: "Last month", occasionOn: days(-30) });
    await seedGiftPlan({ subjectName: "Distant", occasion: "Next year", occasionOn: days(200) });

    const view = await checkin(MEMBER);

    expect(view.records.filter((record) => record.family === "gift_plan")).toEqual([]);
  });

  it("says a family could not be read rather than borrowing the empty state's words", async () => {
    // "Nothing to check in on" and "we could not look" are different facts, and a
    // member reading the wrong one would believe a shared chore had been dealt with.
    const { service } = await household();
    const failing = createHouseholdHomeService({
      readAdmittedHousehold: async () => ({ id: "household-1", name: "Ash Lane" }),
      listMemberNames: async () => [],
      loadCandidateFamilies: [
        async () => {
          throw new Error("family unavailable");
        },
      ],
      proveRecords: async () => [],
      readCheckinOptIn: async () => true,
    });
    expect(service).toBeDefined();

    const view = await failing.getHouseholdCheckin({
      callerUserId: MEMBER,
      localDate: LOCAL_DATE,
      now: NOW,
    });

    expect(view.records).toEqual([]);
    expect(view.limitations).toEqual([
      "The check-in is temporarily unavailable. Your household's records are unchanged.",
    ]);
  });
});
