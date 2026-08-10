import { describe, expect, it, vi } from "vitest";
import { createInMemoryGeneralActionLifecycleStore } from "../general-actions/in-memory-store";
import { createGeneralActionLifecycle } from "../general-actions/lifecycle";
import { createHouseholdAuthorizationProver } from "../households/authorization";
import { removeHouseholdMember, seedHouseholdWithMembers } from "../households/household-fixtures";
import { loadHouseholdActionCandidates } from "./candidate-loaders/actions";
import { createHouseholdHomeService, type HouseholdHomeServiceDeps } from "./service";
import type { HouseholdHomeCandidateLoader, HouseholdHomeView } from "./types";

/**
 * The Household home composed over a real two-member household.
 *
 * Every rule the home owes is about the difference between two members looking
 * at the same workspace, so a single-actor fixture could not have proved any of
 * them: what both see identically, what one legitimately sees and the other does
 * not, and what neither can reach once their membership ends.
 */
const OWNER = "user-owner";
const MEMBER = "user-member";
const OUTSIDER = "user-outsider";

const NOW = new Date("2026-07-21T15:00:00.000Z");
const LOCAL_DATE = "2026-07-21";

function days(count: number): Date {
  return new Date(NOW.getTime() + count * 24 * 60 * 60 * 1_000);
}

async function household(overrides: { extraFamilies?: HouseholdHomeCandidateLoader[] } = {}) {
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
      ...(overrides.extraFamilies ?? []),
    ],
    proveRecords: (input) => prover.proveVisibleRecords(input),
  };

  const service = createHouseholdHomeService(deps);

  const home = (callerUserId: string): Promise<HouseholdHomeView> =>
    service.getHouseholdHome({ callerUserId, localDate: LOCAL_DATE, now: NOW });

  const seedHouseholdNative = (overrides: {
    title?: string;
    dueAt?: Date | null;
    createdBy?: string;
    responsibilityHolderUserId?: string | null;
    recurrence?: { interval: number; unit: "day" | "week" | "month" | "year" } | null;
  }) =>
    lifecycle.createGeneralAction({
      ownerUserId: overrides.createdBy ?? OWNER,
      title: overrides.title ?? "Put the bins out",
      ownership: "household_native",
      householdId: workspace.id,
      dueAt: overrides.dueAt ?? null,
      recurrence: overrides.recurrence ?? null,
      responsibilityHolderUserId: overrides.responsibilityHolderUserId ?? null,
    });

  return { store, lifecycle, workspace, service, home, seedHouseholdNative };
}

function titles(records: ReadonlyArray<{ title: string }>): string[] {
  return records.map((record) => record.title);
}

describe("the Household home frame", () => {
  it("names the household for an active member", async () => {
    const { home } = await household();

    await expect(home(MEMBER)).resolves.toMatchObject({
      household: { name: "Ash Lane" },
    });
  });

  it("gives a member who has left no frame and no records", async () => {
    const { home, store, workspace, seedHouseholdNative } = await household();
    await seedHouseholdNative({ dueAt: NOW });
    await expect(home(MEMBER)).resolves.toMatchObject({ household: { name: "Ash Lane" } });

    await removeHouseholdMember(store, { householdId: workspace.id, userId: MEMBER });

    const after = await home(MEMBER);
    expect(after.household).toBeNull();
    expect(after.needsAttention.records).toEqual([]);
    expect(after.comingUp.records).toEqual([]);
  });

  it("gives a stranger nothing at all", async () => {
    const { home, seedHouseholdNative } = await household();
    await seedHouseholdNative({ dueAt: NOW });

    const outside = await home(OUTSIDER);
    expect(outside.household).toBeNull();
    expect(outside.needsAttention.records).toEqual([]);
  });
});

describe("what composes into the Household home", () => {
  it("shows a household-native chore identically to both members", async () => {
    const { home, seedHouseholdNative } = await household();
    await seedHouseholdNative({ title: "Put the bins out", dueAt: NOW });

    const forOwner = await home(OWNER);
    const forMember = await home(MEMBER);

    expect(titles(forOwner.needsAttention.records)).toEqual(["Put the bins out"]);
    expect(titles(forMember.needsAttention.records)).toEqual(["Put the bins out"]);
    expect(forOwner.needsAttention.records[0]?.scopeLabel).toBe("Household");
    expect(forMember.needsAttention.records[0]?.scopeLabel).toBe("Household");
  });

  it("credits a member's own shared record to them, and says so differently to each reader", async () => {
    const { home, lifecycle, workspace } = await household();
    await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "My dentist appointment",
      scope: "household",
      householdId: workspace.id,
      dueAt: NOW,
    });

    await expect(home(OWNER)).resolves.toMatchObject({
      needsAttention: { records: [{ scopeLabel: "Shared by you" }] },
    });
    await expect(home(MEMBER)).resolves.toMatchObject({
      needsAttention: { records: [{ scopeLabel: "Shared by Nick" }] },
    });
  });

  it("names who is looking after a chore, and says nothing when nobody is", async () => {
    const { home, seedHouseholdNative } = await household();
    await seedHouseholdNative({
      title: "Water filter",
      dueAt: NOW,
      responsibilityHolderUserId: MEMBER,
    });

    await expect(home(MEMBER)).resolves.toMatchObject({
      needsAttention: { records: [{ responsibility: "You're looking after this" }] },
    });
    await expect(home(OWNER)).resolves.toMatchObject({
      needsAttention: { records: [{ responsibility: "Mara is looking after this" }] },
    });
  });

  it("leaves an unnamed chore unnamed rather than reporting a gap", async () => {
    const { home, seedHouseholdNative } = await household();
    await seedHouseholdNative({ dueAt: NOW });

    await expect(home(OWNER)).resolves.toMatchObject({
      needsAttention: { records: [{ responsibility: null }] },
    });
  });

  it("keeps a member's private record off the shared home, including their own", async () => {
    const { home, lifecycle } = await household();
    await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Buy a birthday card",
      dueAt: NOW,
    });

    await expect(home(OWNER)).resolves.toMatchObject({ needsAttention: { records: [] } });
    await expect(home(MEMBER)).resolves.toMatchObject({ needsAttention: { records: [] } });
  });

  it("lets selected-member sharing produce a different authorized composition", async () => {
    const { home, lifecycle, workspace } = await household();
    await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Split task",
      scope: "shared",
      householdId: workspace.id,
      selectedUserIds: [MEMBER],
      dueAt: NOW,
    });

    await expect(home(MEMBER)).resolves.toMatchObject({
      needsAttention: { records: [{ title: "Split task" }] },
    });
  });

  it("drops a record the caller's own domain excludes them from", async () => {
    // The Surprise Subject rule reaches the home through the proof rather than
    // through each family: a family that names an excluded member gets no row,
    // no placeholder, and no count, before any gift plan exists to prove it on.
    const { home, seedHouseholdNative, workspace } = await household({
      extraFamilies: [
        async (input) => [
          {
            facts: {
              kind: "gift_plan",
              id: "plan-1",
              ownerUserId: OWNER,
              scope: "shared",
              householdId: workspace.id,
              excludedUserIds: [MEMBER],
            },
            record: {
              identity: "action:plan-1",
              family: "action" as const,
              section: "coming_up" as const,
              pressing: false,
              record: { kind: "general_action" as const, id: "plan-1", href: "/gift-plans/plan-1" },
              title: "A surprise",
              context: "Action",
              timing: { code: "scheduled" as const, explanation: "Due 1 Aug." },
              scopeLabel: "Shared by Nick",
              responsibility: null,
              progress: null,
              at: days(3),
              createdAt: input.now,
            },
          },
        ],
      ],
    });
    await seedHouseholdNative({ title: "Put the bins out", dueAt: NOW });

    const forMember = await home(MEMBER);
    expect(titles(forMember.comingUp.records)).toEqual([]);
    expect(JSON.stringify(forMember)).not.toContain("A surprise");
    // The excluded member still sees everything else, unchanged.
    expect(titles(forMember.needsAttention.records)).toEqual(["Put the bins out"]);
  });
});

describe("how the home dates a record", () => {
  it("puts what the household has already reached under Needs attention", async () => {
    const { home, seedHouseholdNative } = await household();
    await seedHouseholdNative({ title: "Waiting", dueAt: days(-3) });
    await seedHouseholdNative({ title: "Today", dueAt: NOW });

    const forOwner = await home(OWNER);
    expect(titles(forOwner.needsAttention.records)).toEqual(["Waiting", "Today"]);
    expect(forOwner.needsAttention.records[0]?.timing.explanation).toBe("Waiting since Jul 18.");
    expect(forOwner.needsAttention.records[1]?.timing.explanation).toBe("Due today.");
  });

  it("never says overdue, late, or missed", async () => {
    const { home, seedHouseholdNative } = await household();
    await seedHouseholdNative({ title: "Waiting", dueAt: days(-30) });

    const explanation = (await home(OWNER)).needsAttention.records[0]?.timing.explanation ?? "";
    expect(explanation).not.toMatch(/overdue|late|missed|behind/i);
  });

  it("puts a dated record approaching soon under Coming up", async () => {
    const { home, seedHouseholdNative } = await household();
    await seedHouseholdNative({ title: "Parking permit", dueAt: days(5) });

    await expect(home(OWNER)).resolves.toMatchObject({
      comingUp: { records: [{ title: "Parking permit", timing: { code: "scheduled" } }] },
      needsAttention: { records: [] },
    });
  });

  it("leaves a far-off record on its own domain surface", async () => {
    const { home, seedHouseholdNative } = await household();
    await seedHouseholdNative({ title: "Next season", dueAt: days(90) });

    const forOwner = await home(OWNER);
    expect(forOwner.comingUp.records).toEqual([]);
    expect(forOwner.needsAttention.records).toEqual([]);
  });

  it("leaves an undated chore off both sections rather than starting a backlog", async () => {
    const { home, seedHouseholdNative } = await household();
    await seedHouseholdNative({ title: "Sort the loft out", dueAt: null });

    const forOwner = await home(OWNER);
    expect(forOwner.needsAttention.records).toEqual([]);
    expect(forOwner.comingUp.records).toEqual([]);
  });

  it("keeps a paused Routine off the home entirely", async () => {
    const { home, lifecycle, seedHouseholdNative } = await household();
    const routine = await seedHouseholdNative({
      title: "Bin day",
      dueAt: NOW,
      recurrence: { interval: 1, unit: "week" },
    });
    await expect(home(OWNER)).resolves.toMatchObject({
      needsAttention: { records: [{ title: "Bin day" }] },
    });

    await lifecycle.pauseGeneralAction({ actorUserId: MEMBER, generalActionId: routine.id });

    await expect(home(OWNER)).resolves.toMatchObject({ needsAttention: { records: [] } });
    await expect(home(MEMBER)).resolves.toMatchObject({ needsAttention: { records: [] } });
  });

  it("brings a deferred record back only once its return date has arrived", async () => {
    const { home, lifecycle, seedHouseholdNative } = await household();
    const chore = await seedHouseholdNative({ title: "Descale the kettle", dueAt: NOW });
    await lifecycle.deferGeneralAction({
      actorUserId: OWNER,
      generalActionId: chore.id,
      deferUntil: days(4),
    });

    await expect(home(OWNER)).resolves.toMatchObject({ needsAttention: { records: [] } });

    const later = await household();
    // A record whose return date has passed is back, and is not treated as
    // pressing: someone deliberately put it down.
    const returned = await later.seedHouseholdNative({ title: "Descale", dueAt: NOW });
    await later.lifecycle.deferGeneralAction({
      actorUserId: OWNER,
      generalActionId: returned.id,
      deferUntil: days(-1),
    });

    const forOwner = await later.home(OWNER);
    expect(forOwner.needsAttention.records).toMatchObject([
      { title: "Descale", timing: { code: "resurfaced" }, pressing: false },
    ]);
  });

  it("carries the occurrence the member is looking at into the inline completion", async () => {
    const { home, lifecycle, service, seedHouseholdNative } = await household();
    const routine = await seedHouseholdNative({
      title: "Bin day",
      dueAt: NOW,
      recurrence: { interval: 1, unit: "week" },
    });
    await expect(home(OWNER)).resolves.toMatchObject({
      needsAttention: {
        records: [{ progress: { kind: "complete_record", expectedOccurrenceVersion: 0 } }],
      },
    });

    // The other member settles the occurrence. The next one the household sees
    // is fenced on the advance, so a tap made against the old row reconciles
    // rather than rolling the Routine forward twice (#383).
    const settled = await lifecycle.completeGeneralAction({
      actorUserId: MEMBER,
      generalActionId: routine.id,
    });
    const nextDueAt = settled.dueAt as Date;

    const nextOccurrence = await service.getHouseholdHome({
      callerUserId: OWNER,
      localDate: nextDueAt.toISOString().slice(0, 10),
      now: nextDueAt,
    });
    expect(nextOccurrence.needsAttention.records).toMatchObject([
      { progress: { kind: "complete_record", expectedOccurrenceVersion: 1 } },
    ]);
  });
});

describe("acting on a record after access has ended", () => {
  /**
   * The home's one inline control is the case that matters here: a member can
   * be looking at a rendered row at the moment their membership ends, and the
   * tap that follows must be refused on the record's own terms rather than
   * succeeding because the page still showed a button.
   */
  it("refuses a departed member's completion with the one opaque answer", async () => {
    const { home, lifecycle, store, workspace, seedHouseholdNative } = await household();
    const chore = await seedHouseholdNative({ title: "Put the bins out", dueAt: NOW });
    const rendered = (await home(MEMBER)).needsAttention.records[0];
    expect(rendered?.progress).toMatchObject({ kind: "complete_record" });

    await removeHouseholdMember(store, { householdId: workspace.id, userId: MEMBER });

    await expect(
      lifecycle.completeGeneralAction({
        actorUserId: MEMBER,
        generalActionId: chore.id,
        expectedOccurrenceVersion: rendered?.progress?.expectedOccurrenceVersion,
      }),
    ).rejects.toThrow(/no longer available/);
    // The household keeps the record, untouched, and still sees it.
    await expect(home(OWNER)).resolves.toMatchObject({
      needsAttention: { records: [{ title: "Put the bins out" }] },
    });
  });

  it("refuses a stranger the same way, saying nothing about the record", async () => {
    const { lifecycle, seedHouseholdNative } = await household();
    const chore = await seedHouseholdNative({ title: "Put the bins out", dueAt: NOW });

    await expect(
      lifecycle.completeGeneralAction({ actorUserId: OUTSIDER, generalActionId: chore.id }),
    ).rejects.toThrow(/no longer available/);
  });
});

describe("when a domain family cannot be read", () => {
  it("keeps the families that succeeded and explains the gap once", async () => {
    const { home, seedHouseholdNative } = await household({
      extraFamilies: [() => Promise.reject(new Error("family offline"))],
    });
    await seedHouseholdNative({ title: "Put the bins out", dueAt: NOW });

    const forOwner = await home(OWNER);
    expect(titles(forOwner.needsAttention.records)).toEqual(["Put the bins out"]);
    expect(forOwner.needsAttention.limitations).toEqual([
      "Part of Household is temporarily unavailable. Your household's records are unchanged.",
    ]);
    expect(forOwner.comingUp.limitations).toEqual(forOwner.needsAttention.limitations);
  });

  it("never names the source that failed", async () => {
    const { home } = await household({
      extraFamilies: [() => Promise.reject(new Error("gift_plans store timed out"))],
    });

    const forOwner = await home(OWNER);
    expect(forOwner.needsAttention.limitations.join(" ")).not.toMatch(/gift|store|timed out/i);
  });
});

describe("the proof runs on every composition", () => {
  it("asks for each record on its own facts, and never trusts the listing", async () => {
    const { seedHouseholdNative, store, workspace } = await household();
    await seedHouseholdNative({ dueAt: NOW });
    const prover = createHouseholdAuthorizationProver(store);
    const proveRecords = vi.fn(prover.proveVisibleRecords);
    const lifecycle = createGeneralActionLifecycle(store);

    const service = createHouseholdHomeService({
      readAdmittedHousehold: async () => ({ id: workspace.id, name: workspace.name }),
      listMemberNames: async () => [],
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
      proveRecords,
    });

    await service.getHouseholdHome({ callerUserId: MEMBER, localDate: LOCAL_DATE, now: NOW });

    expect(proveRecords).toHaveBeenCalledWith(
      expect.objectContaining({ callerUserId: MEMBER, operation: "view" }),
    );
  });
});
