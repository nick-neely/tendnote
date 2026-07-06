import type { CreateGeneralActionInput } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createInMemoryGeneralActionStore } from "./in-memory-store";
import type { GeneralActionStore } from "./types";

const OWNER = "user-1";

/**
 * Behavioral contract every `GeneralActionStore` must satisfy, so both the
 * in-memory and drizzle stores back the surface identically. It is run against the
 * in-memory store directly here; the drizzle store — which has no live-DB harness
 * in this package — is guarded to the same two behaviors by `drizzle-store.test.ts`
 * (it must parse update patches with the defaults-free schema and order by the same
 * surfacing-time expression). The two together keep the stores from diverging.
 */
function runStoreContract(name: string, makeStore: () => GeneralActionStore) {
  describe(`${name} store contract`, () => {
    function seed(store: GeneralActionStore, overrides: Partial<CreateGeneralActionInput> = {}) {
      return store.createGeneralAction({
        ownerUserId: OWNER,
        title: "Replace the water filter",
        notes: "Model MWF",
        links: [{ url: "https://example.com/filter" }],
        status: "open",
        dueAt: new Date("2026-08-01T00:00:00Z"),
        deferUntil: null,
        sourceRecordId: null,
        scope: "private",
        householdId: null,
        createdByUserId: OWNER,
        lastActorUserId: OWNER,
        completedAt: null,
        ...overrides,
      });
    }

    it("a status-only update leaves untouched columns intact (no default wipe)", async () => {
      const store = makeStore();
      const action = await seed(store);

      const updated = await store.updateGeneralAction({
        ownerUserId: OWNER,
        generalActionId: action.id,
        patch: {
          status: "deferred",
          deferUntil: new Date("2026-09-01T00:00:00Z"),
          lastActorUserId: OWNER,
        },
      });

      expect(updated.status).toBe("deferred");
      // The columns the patch never mentioned must survive.
      expect(updated.dueAt?.toISOString()).toBe(action.dueAt?.toISOString());
      expect(updated.notes).toBe("Model MWF");
      expect(updated.links).toEqual([{ url: "https://example.com/filter" }]);
      expect(updated.scope).toBe("private");
    });

    it("round-trips a Routine's cadence and preserves it through a status-only update", async () => {
      const store = makeStore();
      const routine = await seed(store, {
        title: "Replace the filter",
        recurrence: { interval: 6, unit: "month" },
      });
      expect(routine.recurrence).toEqual({ interval: 6, unit: "month" });

      // A defaults-free update must not wipe the cadence column on an unrelated patch.
      const updated = await store.updateGeneralAction({
        ownerUserId: OWNER,
        generalActionId: routine.id,
        patch: { status: "paused", lastActorUserId: OWNER },
      });
      expect(updated.recurrence).toEqual({ interval: 6, unit: "month" });
    });

    it("filters an owner listing to the requested statuses (the review queue's read path)", async () => {
      const store = makeStore();
      await seed(store, { title: "Active", status: "open" });
      await seed(store, { title: "Proposal", status: "suggested" });
      await seed(store, { title: "Set-aside proposal", status: "ignored" });
      await seed(store, { title: "Done", status: "completed" });

      // The Suggested review queue reads exactly this: status-scoped owner listing.
      const suggested = await store.listGeneralActionsForOwner({
        ownerUserId: OWNER,
        statuses: ["suggested"],
      });
      expect(suggested.map((action) => action.title)).toEqual(["Proposal"]);

      // Multiple statuses (e.g. the resolved trail) are honored together.
      const resolved = await store.listGeneralActionsForOwner({
        ownerUserId: OWNER,
        statuses: ["completed", "dismissed"],
      });
      expect(resolved.map((action) => action.title)).toEqual(["Done"]);
    });

    it("orders by surfacing time: coalesce(deferUntil, dueAt), unscheduled last", async () => {
      const store = makeStore();
      await seed(store, { title: "Later", dueAt: new Date("2026-09-01T00:00:00Z") });
      await seed(store, { title: "Unscheduled", dueAt: null });
      await seed(store, {
        title: "Deferred soon",
        status: "deferred",
        dueAt: null,
        deferUntil: new Date("2026-07-01T00:00:00Z"),
      });
      await seed(store, { title: "Due soon", dueAt: new Date("2026-08-01T00:00:00Z") });

      const listed = await store.listGeneralActionsForOwner({ ownerUserId: OWNER });

      expect(listed.map((action) => action.title)).toEqual([
        "Deferred soon",
        "Due soon",
        "Later",
        "Unscheduled",
      ]);
    });
  });
}

runStoreContract("in-memory", createInMemoryGeneralActionStore);

const MEMBER = "user-2";
const OUTSIDER = "user-3";

/**
 * Contract for the scope-visibility and people-link methods added in #180. Like the
 * base contract this runs against the in-memory store (the drizzle store is source-
 * guarded in `drizzle-store.test.ts`). The in-memory store bundles a household store,
 * so the same instance drives memberships, shares, and the visible reads.
 */
describe("in-memory store scope + people contract", () => {
  async function setupHousehold() {
    const store = createInMemoryGeneralActionStore();
    const household = await store.createHouseholdWorkspace({
      ownerUserId: OWNER,
      name: "Household",
      defaultScope: "private",
    });
    for (const [userId, role] of [
      [OWNER, "owner"],
      [MEMBER, "member"],
    ] as const) {
      await store.createHouseholdMembership({
        householdId: household.id,
        userId,
        invitedByUserId: OWNER,
        role,
        status: "active",
        invitedAt: new Date("2026-06-01T00:00:00Z"),
        acceptedAt: new Date("2026-06-01T00:00:00Z"),
        removedAt: null,
      });
    }

    function seed(overrides: Partial<CreateGeneralActionInput> = {}) {
      return store.createGeneralAction({
        ownerUserId: OWNER,
        title: "Action",
        notes: null,
        links: [],
        status: "open",
        dueAt: null,
        deferUntil: null,
        sourceRecordId: null,
        scope: "private",
        householdId: null,
        createdByUserId: OWNER,
        lastActorUserId: OWNER,
        completedAt: null,
        ...overrides,
      });
    }

    return { store, household, seed };
  }

  it("getVisibleGeneralAction admits an active member and refuses an outsider", async () => {
    const { store, household, seed } = await setupHousehold();
    const action = await seed({ scope: "household", householdId: household.id });

    await expect(
      store.getVisibleGeneralAction({ callerUserId: MEMBER, generalActionId: action.id }),
    ).resolves.toMatchObject({ id: action.id });
    await expect(
      store.getVisibleGeneralAction({ callerUserId: OUTSIDER, generalActionId: action.id }),
    ).resolves.toBeNull();
  });

  it("listVisibleGeneralActionsForCaller applies scope, then the surfacing-time order", async () => {
    const { store, household, seed } = await setupHousehold();
    // A member sees household actions but not the owner's private one, and gets them
    // due-first with unscheduled last — the same ordering contract as the owner list.
    await seed({ title: "Private", scope: "private" });
    const later = await seed({
      title: "Later",
      scope: "household",
      householdId: household.id,
      dueAt: new Date("2026-09-01T00:00:00Z"),
    });
    const unscheduled = await seed({
      title: "Unscheduled",
      scope: "household",
      householdId: household.id,
    });
    const sooner = await seed({
      title: "Sooner",
      scope: "household",
      householdId: household.id,
      dueAt: new Date("2026-07-01T00:00:00Z"),
    });

    const visible = await store.listVisibleGeneralActionsForCaller({ callerUserId: MEMBER });

    expect(visible.map((action) => action.id)).toEqual([sooner.id, later.id, unscheduled.id]);
    expect(visible.some((action) => action.title === "Private")).toBe(false);
  });

  it("round-trips people links owner-keyed and refuses a non-owner", async () => {
    const { store, seed } = await setupHousehold();
    const action = await seed();
    const personId = "00000000-0000-0000-0000-0000000000aa";

    await store.setGeneralActionPeople({
      ownerUserId: OWNER,
      generalActionId: action.id,
      personIds: [personId, personId],
    });
    await expect(
      store.listGeneralActionPersonIds({ ownerUserId: OWNER, generalActionId: action.id }),
    ).resolves.toEqual([personId]);

    // A non-owner can neither read nor rewrite the links.
    await expect(
      store.listGeneralActionPersonIds({ ownerUserId: MEMBER, generalActionId: action.id }),
    ).resolves.toEqual([]);
    await expect(
      store.setGeneralActionPeople({
        ownerUserId: MEMBER,
        generalActionId: action.id,
        personIds: [],
      }),
    ).rejects.toThrow(/Action not found/);
  });
});
