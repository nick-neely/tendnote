import { describe, expect, it } from "vitest";
import { createInMemoryGeneralActionLifecycleStore } from "../general-actions/in-memory-store";
import { createGeneralActionLifecycle } from "../general-actions/lifecycle";
import { createHouseholdAuthorizationProver } from "../households/authorization";
import { seedHouseholdWithMembers } from "../households/household-fixtures";
import { loadActionCandidates } from "../today/candidate-loaders/actions";
import { createInMemoryTodayFeedbackStore } from "../today/in-memory-store";
import { createTodayShortlistService } from "../today/service";
import { loadHouseholdActionCandidates } from "./candidate-loaders/actions";
import { createHouseholdHomeService } from "./service";

/**
 * The boundary between the shared Household home and each member's private
 * Today, exercised over one household with two members.
 *
 * These two surfaces answer different questions — "what are we coordinating"
 * and "what is relevant to me now" — and the whole risk in shipping them
 * together is that one quietly becomes the other. So the cases here are all
 * about what must *not* travel: household visibility must not become personal
 * urgency, and one member's private curation must not touch what the other
 * member, or the household, sees.
 */
const OWNER = "user-owner";
const MEMBER = "user-member";

const NOW = new Date("2026-07-21T15:00:00.000Z");
const LOCAL_DATE = "2026-07-21";

async function household() {
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
  const subscriptions = new Map<string, Set<string>>();

  const homeService = createHouseholdHomeService({
    readAdmittedHousehold: async ({ callerUserId }) => {
      const memberships = await store.listActiveHouseholdMembershipsForUser({
        userId: callerUserId,
      });
      return memberships[0] ? { id: workspace.id, name: workspace.name } : null;
    },
    listMemberNames: async () => [
      { userId: OWNER, name: "Nick" },
      { userId: MEMBER, name: "Mara" },
    ],
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
  });

  const todayService = createTodayShortlistService({
    feedbackStore: createInMemoryTodayFeedbackStore(),
    loadCandidateFamilies: [
      (input) =>
        loadActionCandidates(
          {
            listActions: ({ ownerUserId, limit }) =>
              lifecycle.listActiveGeneralActions({ ownerUserId, limit }),
            listOwnReminderRecordIds: async ({ ownerUserId }) => [
              ...(subscriptions.get(ownerUserId) ?? []),
            ],
            getSourceRecord: async () => null,
          },
          input,
        ),
    ],
  });

  return {
    lifecycle,
    workspace,
    subscribe(userId: string, recordId: string) {
      subscriptions.set(userId, (subscriptions.get(userId) ?? new Set()).add(recordId));
    },
    home: (callerUserId: string) =>
      homeService.getHouseholdHome({ callerUserId, localDate: LOCAL_DATE, now: NOW }),
    today: (ownerUserId: string) =>
      todayService.getTodayShortlist({ ownerUserId, localDate: LOCAL_DATE, now: NOW }),
    notToday: (ownerUserId: string, candidateIdentity: string, reasonKey: string) =>
      todayService.suppressTodayCandidate({
        ownerUserId,
        localDate: LOCAL_DATE,
        candidateIdentity,
        reasonKey,
        kind: "not_today",
        suppressUntil: null,
        now: NOW,
      }),
    chore: (overrides: { title?: string; holder?: string | null } = {}) =>
      lifecycle.createGeneralAction({
        ownerUserId: OWNER,
        title: overrides.title ?? "Put the bins out",
        ownership: "household_native",
        householdId: workspace.id,
        dueAt: NOW,
        responsibilityHolderUserId: overrides.holder ?? null,
      }),
  };
}

function titles(records: ReadonlyArray<{ title: string }>): string[] {
  return records.map((record) => record.title);
}

describe("household visibility is not personal relevance", () => {
  it("leaves an unnamed household chore on the shared home and out of everyone's Today", async () => {
    const fixture = await household();
    await fixture.chore({ title: "Put the bins out" });

    await expect(fixture.home(OWNER)).resolves.toMatchObject({
      needsAttention: { records: [{ title: "Put the bins out" }] },
    });
    expect(titles((await fixture.today(OWNER)).items)).toEqual([]);
    expect(titles((await fixture.today(MEMBER)).items)).toEqual([]);
  });

  it("admits the chore to the named member's Today, and only theirs", async () => {
    const fixture = await household();
    await fixture.chore({ title: "Water filter", holder: MEMBER });

    expect(titles((await fixture.today(MEMBER)).items)).toEqual(["Water filter"]);
    expect(titles((await fixture.today(OWNER)).items)).toEqual([]);
  });

  it("admits the chore to a member who chose their own reminder for it", async () => {
    const fixture = await household();
    const chore = await fixture.chore({ title: "Bin day" });
    fixture.subscribe(OWNER, chore.id);

    expect(titles((await fixture.today(OWNER)).items)).toEqual(["Bin day"]);
    expect(titles((await fixture.today(MEMBER)).items)).toEqual([]);
  });

  it("admits a member's own shared record to their Today and not their partner's", async () => {
    const fixture = await household();
    await fixture.lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "My dentist appointment",
      scope: "household",
      householdId: fixture.workspace.id,
      dueAt: NOW,
    });

    expect(titles((await fixture.today(OWNER)).items)).toEqual(["My dentist appointment"]);
    expect(titles((await fixture.today(MEMBER)).items)).toEqual([]);
  });
});

describe("a member's Not today stays theirs", () => {
  it("does not hide or reorder the record on the shared home for anybody", async () => {
    const fixture = await household();
    await fixture.chore({ title: "Water filter", holder: MEMBER });
    const before = (await fixture.today(MEMBER)).items[0];

    await fixture.notToday(MEMBER, before?.identity ?? "", before?.reason.key ?? "");

    expect(titles((await fixture.today(MEMBER)).items)).toEqual([]);
    await expect(fixture.home(MEMBER)).resolves.toMatchObject({
      needsAttention: { records: [{ title: "Water filter" }] },
    });
    await expect(fixture.home(OWNER)).resolves.toMatchObject({
      needsAttention: { records: [{ title: "Water filter" }] },
    });
  });

  it("does not touch the other member's Today", async () => {
    const fixture = await household();
    const chore = await fixture.chore({ title: "Bin day", holder: MEMBER });
    fixture.subscribe(OWNER, chore.id);
    const forMember = (await fixture.today(MEMBER)).items[0];

    await fixture.notToday(MEMBER, forMember?.identity ?? "", forMember?.reason.key ?? "");

    expect(titles((await fixture.today(MEMBER)).items)).toEqual([]);
    expect(titles((await fixture.today(OWNER)).items)).toEqual(["Bin day"]);
  });

  it("leaves the shared home's order exactly as it was", async () => {
    const fixture = await household();
    await fixture.chore({ title: "Water filter", holder: MEMBER });
    await fixture.chore({ title: "Bin day", holder: MEMBER });
    const orderBefore = titles((await fixture.home(MEMBER)).needsAttention.records);
    const first = (await fixture.today(MEMBER)).items[0];

    await fixture.notToday(MEMBER, first?.identity ?? "", first?.reason.key ?? "");

    expect(titles((await fixture.home(MEMBER)).needsAttention.records)).toEqual(orderBefore);
  });
});
