import { describe, expect, it } from "vitest";
import { createGeneralActionAreaManager } from "../general-action-areas/lifecycle";
import { removeHouseholdMember, seedHouseholdWithMembers } from "../households/household-fixtures";
import { createInMemoryGeneralActionLifecycleStore } from "./in-memory-store";
import { createGeneralActionLifecycle } from "./lifecycle";

const OWNER = "user-1";
const OTHER = "user-2";
// Household actors: OWNER is the household owner, MEMBER and OTHER_MEMBER are active
// members, OUTSIDER belongs to no household.
const MEMBER = "user-member";
const OTHER_MEMBER = "user-other-member";
const OUTSIDER = "user-outsider";

async function setup() {
  const store = createInMemoryGeneralActionLifecycleStore();
  const lifecycle = createGeneralActionLifecycle(store);
  // The Area manager shares the same composed store, so an Area seeded here is the
  // one the action lifecycle resolves against.
  const areas = createGeneralActionAreaManager(store);

  async function seedOpen(
    overrides: {
      title?: string;
      dueAt?: Date | null;
      notes?: string | null;
      ownerUserId?: string;
    } = {},
  ) {
    return lifecycle.createGeneralAction({
      ownerUserId: overrides.ownerUserId ?? OWNER,
      title: overrides.title ?? "Replace the refrigerator water filter",
      dueAt: overrides.dueAt,
      notes: overrides.notes,
    });
  }

  const historyKinds = async (generalActionId: string) =>
    (await lifecycle.listGeneralActionHistory({ actorUserId: OWNER, generalActionId })).map(
      (event) => event.kind,
    );

  return { store, lifecycle, areas, seedOpen, historyKinds };
}

describe("create general action", () => {
  it("creates an open, private action with creator + actor provenance and a created event", async () => {
    const { lifecycle, historyKinds } = await setup();

    const action = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Renew the car registration",
      dueAt: new Date("2026-08-01T00:00:00Z"),
      notes: "Online portal, needs the VIN",
    });

    expect(action.status).toBe("open");
    expect(action.scope).toBe("private");
    expect(action.householdId).toBeNull();
    expect(action.ownerUserId).toBe(OWNER);
    expect(action.createdByUserId).toBe(OWNER);
    expect(action.lastActorUserId).toBe(OWNER);
    expect(action.title).toBe("Renew the car registration");
    expect(action.notes).toBe("Online portal, needs the VIN");
    expect(action.dueAt?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    await expect(historyKinds(action.id)).resolves.toEqual(["created"]);
  });

  it("allows an unscheduled action with no due date", async () => {
    const { seedOpen } = await setup();
    const action = await seedOpen({ dueAt: null });

    expect(action.dueAt).toBeNull();
    expect(action.status).toBe("open");
  });

  it("rejects a blank title", async () => {
    const { lifecycle } = await setup();

    await expect(
      lifecycle.createGeneralAction({ ownerUserId: OWNER, title: "   " }),
    ).rejects.toThrow();
  });

  it("stores lightweight links but rejects a non-URL link", async () => {
    const { lifecycle } = await setup();

    const action = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Order a replacement filter",
      links: [{ url: "https://example.com/filter", label: "Filter model" }],
    });
    expect(action.links).toEqual([{ url: "https://example.com/filter", label: "Filter model" }]);

    await expect(
      lifecycle.editGeneralAction({
        actorUserId: OWNER,
        generalActionId: action.id,
        edit: { links: [{ url: "not-a-url" }] },
      }),
    ).rejects.toThrow();
  });

  it("rejects grounding on a source record the owner cannot see", async () => {
    const { lifecycle } = await setup();

    await expect(
      lifecycle.createGeneralAction({
        ownerUserId: OWNER,
        title: "From a suggestion",
        sourceRecordId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow(/Source record not found/);
  });
});

describe("edit general action", () => {
  it("edits title, notes, and due date with an edited event", async () => {
    const { lifecycle, seedOpen, historyKinds } = await setup();
    const action = await seedOpen();

    const edited = await lifecycle.editGeneralAction({
      actorUserId: OWNER,
      generalActionId: action.id,
      edit: {
        title: "Replace the fridge + freezer water filters",
        notes: "Two filters now",
        dueAt: new Date("2026-09-01T00:00:00Z"),
      },
    });

    expect(edited.title).toBe("Replace the fridge + freezer water filters");
    expect(edited.notes).toBe("Two filters now");
    expect(edited.dueAt?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    await expect(historyKinds(action.id)).resolves.toEqual(["created", "edited"]);
  });

  it("clears an optional field with explicit null but leaves omitted fields alone", async () => {
    const { lifecycle, seedOpen } = await setup();
    const action = await seedOpen({ notes: "Original note", dueAt: new Date("2026-08-01Z") });

    const edited = await lifecycle.editGeneralAction({
      actorUserId: OWNER,
      generalActionId: action.id,
      edit: { notes: null },
    });

    expect(edited.notes).toBeNull();
    // dueAt was omitted, so it is untouched.
    expect(edited.dueAt?.toISOString()).toBe(action.dueAt?.toISOString());
  });

  it("rejects an empty edit that would change nothing", async () => {
    const { lifecycle, seedOpen } = await setup();
    const action = await seedOpen();

    await expect(
      lifecycle.editGeneralAction({ actorUserId: OWNER, generalActionId: action.id, edit: {} }),
    ).rejects.toThrow(
      /must change the title, notes, due date, cadence, links, area, or asset hints/,
    );
  });

  it("cannot edit a completed action", async () => {
    const { lifecycle, seedOpen } = await setup();
    const action = await seedOpen();
    await lifecycle.completeGeneralAction({ actorUserId: OWNER, generalActionId: action.id });

    await expect(
      lifecycle.editGeneralAction({
        actorUserId: OWNER,
        generalActionId: action.id,
        edit: { title: "Too late" },
      }),
    ).rejects.toThrow(/Cannot edit/);
  });
});

describe("lifecycle transitions", () => {
  it("completes an action, stamps completedAt, and records history", async () => {
    const { lifecycle, seedOpen, historyKinds } = await setup();
    const action = await seedOpen();

    const completed = await lifecycle.completeGeneralAction({
      actorUserId: OWNER,
      generalActionId: action.id,
    });

    expect(completed.status).toBe("completed");
    expect(completed.completedAt).toBeInstanceOf(Date);
    expect(completed.lastActorUserId).toBe(OWNER);
    await expect(historyKinds(action.id)).resolves.toEqual(["created", "completed"]);
  });

  it("records actor provenance and status transition detail on each history event", async () => {
    const { lifecycle, seedOpen } = await setup();
    const action = await seedOpen();
    await lifecycle.completeGeneralAction({ actorUserId: OWNER, generalActionId: action.id });

    const events = await lifecycle.listGeneralActionHistory({
      actorUserId: OWNER,
      generalActionId: action.id,
    });

    // Every event carries who performed it (ADR 0154) — not just the record.
    expect(events.map((event) => event.actorUserId)).toEqual([OWNER, OWNER]);
    const completedEvent = events.find((event) => event.kind === "completed");
    expect(completedEvent?.actorUserId).toBe(OWNER);
    expect(completedEvent?.detailJson).toMatchObject({
      previousStatus: "open",
      status: "completed",
    });
  });

  it("defers an action to a concrete resurface date", async () => {
    const { lifecycle, seedOpen, historyKinds } = await setup();
    const action = await seedOpen();

    const deferred = await lifecycle.deferGeneralAction({
      actorUserId: OWNER,
      generalActionId: action.id,
      deferUntil: new Date("2026-10-01T00:00:00Z"),
    });

    expect(deferred.status).toBe("deferred");
    expect(deferred.deferUntil?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    await expect(historyKinds(action.id)).resolves.toEqual(["created", "deferred"]);
  });

  it("rejects deferring to a vague resurface date", async () => {
    const { lifecycle, seedOpen } = await setup();
    const action = await seedOpen();

    await expect(
      lifecycle.deferGeneralAction({
        actorUserId: OWNER,
        generalActionId: action.id,
        deferUntil: new Date("not a date"),
      }),
    ).rejects.toThrow(/concrete resurface date/);
  });

  it("dismisses an action", async () => {
    const { lifecycle, seedOpen, historyKinds } = await setup();
    const action = await seedOpen();

    const dismissed = await lifecycle.dismissGeneralAction({
      actorUserId: OWNER,
      generalActionId: action.id,
    });

    expect(dismissed.status).toBe("dismissed");
    await expect(historyKinds(action.id)).resolves.toEqual(["created", "dismissed"]);
  });

  it("reopens a completed action and clears its completion time", async () => {
    const { lifecycle, seedOpen, historyKinds } = await setup();
    const action = await seedOpen();
    await lifecycle.completeGeneralAction({ actorUserId: OWNER, generalActionId: action.id });

    const reopened = await lifecycle.reopenGeneralAction({
      actorUserId: OWNER,
      generalActionId: action.id,
    });

    expect(reopened.status).toBe("open");
    expect(reopened.completedAt).toBeNull();
    await expect(historyKinds(action.id)).resolves.toEqual(["created", "completed", "reopened"]);
  });

  it("clears the resurface date when a deferred action is reopened via complete", async () => {
    const { lifecycle, seedOpen } = await setup();
    const action = await seedOpen();
    await lifecycle.deferGeneralAction({
      actorUserId: OWNER,
      generalActionId: action.id,
      deferUntil: new Date("2026-10-01T00:00:00Z"),
    });

    const completed = await lifecycle.completeGeneralAction({
      actorUserId: OWNER,
      generalActionId: action.id,
    });

    expect(completed.status).toBe("completed");
    expect(completed.deferUntil).toBeNull();
  });

  it("archives an action out of active views while preserving history", async () => {
    const { store, lifecycle, seedOpen, historyKinds } = await setup();
    const action = await seedOpen();

    const archived = await lifecycle.archiveGeneralAction({
      actorUserId: OWNER,
      generalActionId: action.id,
    });

    expect(archived.status).toBe("archived");
    // Record still exists...
    await expect(
      store.getGeneralAction({ ownerUserId: OWNER, generalActionId: action.id }),
    ).resolves.not.toBeNull();
    // ...but it is no longer active.
    await expect(lifecycle.listActiveGeneralActions({ ownerUserId: OWNER })).resolves.toEqual([]);
    await expect(historyKinds(action.id)).resolves.toEqual(["created", "archived"]);
  });

  it("rejects invalid transitions", async () => {
    const { lifecycle, seedOpen } = await setup();
    const action = await seedOpen();
    await lifecycle.completeGeneralAction({ actorUserId: OWNER, generalActionId: action.id });

    await expect(
      lifecycle.completeGeneralAction({ actorUserId: OWNER, generalActionId: action.id }),
    ).rejects.toThrow(/Cannot complete/);
  });
});

describe("active listing", () => {
  it("lists open and deferred actions due-first, unscheduled last", async () => {
    const { lifecycle } = await setup();
    await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Later",
      dueAt: new Date("2026-09-01T00:00:00Z"),
    });
    await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Someday (unscheduled)",
    });
    await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Sooner",
      dueAt: new Date("2026-07-01T00:00:00Z"),
    });

    const active = await lifecycle.listActiveGeneralActions({ ownerUserId: OWNER });

    expect(active.map((a) => a.title)).toEqual(["Sooner", "Later", "Someday (unscheduled)"]);
  });

  it("excludes completed, dismissed, and archived actions", async () => {
    const { lifecycle, seedOpen } = await setup();
    const done = await seedOpen({ title: "Done" });
    await lifecycle.completeGeneralAction({ actorUserId: OWNER, generalActionId: done.id });
    const kept = await seedOpen({ title: "Kept" });

    const active = await lifecycle.listActiveGeneralActions({ ownerUserId: OWNER });

    expect(active.map((a) => a.id)).toEqual([kept.id]);
  });

  it("lists resolved (completed + dismissed) actions but not archived ones", async () => {
    const { lifecycle, seedOpen } = await setup();
    const done = await seedOpen({ title: "Done" });
    await lifecycle.completeGeneralAction({ actorUserId: OWNER, generalActionId: done.id });
    const dropped = await seedOpen({ title: "Dropped" });
    await lifecycle.dismissGeneralAction({ actorUserId: OWNER, generalActionId: dropped.id });
    const filed = await seedOpen({ title: "Filed away" });
    await lifecycle.archiveGeneralAction({ actorUserId: OWNER, generalActionId: filed.id });

    const resolved = await lifecycle.listResolvedGeneralActions({ ownerUserId: OWNER });

    expect(resolved.map((a) => a.status).sort()).toEqual(["completed", "dismissed"]);
  });
});

describe("area assignment", () => {
  it("files a new action under an owned area", async () => {
    const { lifecycle, areas } = await setup();
    const home = await areas.createArea({ ownerUserId: OWNER, name: "Home" });

    const action = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Replace the water filter",
      areaId: home.id,
    });

    expect(action.areaId).toBe(home.id);
  });

  it("leaves an action unfiled when no area is given", async () => {
    const { seedOpen } = await setup();
    const action = await seedOpen();

    expect(action.areaId).toBeNull();
  });

  it("assigns and later clears an action's area via edit", async () => {
    const { lifecycle, areas, seedOpen } = await setup();
    const home = await areas.createArea({ ownerUserId: OWNER, name: "Home" });
    const action = await seedOpen();

    const filed = await lifecycle.editGeneralAction({
      actorUserId: OWNER,
      generalActionId: action.id,
      edit: { areaId: home.id },
    });
    expect(filed.areaId).toBe(home.id);

    const unfiled = await lifecycle.editGeneralAction({
      actorUserId: OWNER,
      generalActionId: action.id,
      edit: { areaId: null },
    });
    expect(unfiled.areaId).toBeNull();
  });

  it("rejects filing under another owner's area", async () => {
    const { lifecycle, areas } = await setup();
    const theirs = await areas.createArea({ ownerUserId: OTHER, name: "Home" });

    await expect(
      lifecycle.createGeneralAction({
        ownerUserId: OWNER,
        title: "Sneaky",
        areaId: theirs.id,
      }),
    ).rejects.toThrow(/no longer exists/);
  });

  it("rejects filing under an archived area but keeps an action already filed there", async () => {
    const { lifecycle, areas, seedOpen } = await setup();
    const home = await areas.createArea({ ownerUserId: OWNER, name: "Home" });
    const action = await seedOpen();
    await lifecycle.editGeneralAction({
      actorUserId: OWNER,
      generalActionId: action.id,
      edit: { areaId: home.id },
    });

    await areas.archiveArea({ ownerUserId: OWNER, areaId: home.id });

    // The action keeps its area even though the area is now archived...
    const stillFiled = await lifecycle.getGeneralAction({
      actorUserId: OWNER,
      generalActionId: action.id,
    });
    expect(stillFiled.areaId).toBe(home.id);

    // ...but a new assignment to that archived area is rejected.
    await expect(
      lifecycle.createGeneralAction({
        ownerUserId: OWNER,
        title: "Too late",
        areaId: home.id,
      }),
    ).rejects.toThrow(/archived/);
  });

  it("records an edited event that notes the area change", async () => {
    const { lifecycle, areas, seedOpen, historyKinds } = await setup();
    const home = await areas.createArea({ ownerUserId: OWNER, name: "Home" });
    const action = await seedOpen();

    await lifecycle.editGeneralAction({
      actorUserId: OWNER,
      generalActionId: action.id,
      edit: { areaId: home.id },
    });

    const events = await lifecycle.listGeneralActionHistory({
      actorUserId: OWNER,
      generalActionId: action.id,
    });
    expect(await historyKinds(action.id)).toEqual(["created", "edited"]);
    expect(events.at(-1)?.detailJson).toMatchObject({ editedArea: true });
  });
});

describe("owner scoping", () => {
  it("hides another owner's action from reads and mutations", async () => {
    const { lifecycle, seedOpen } = await setup();
    const action = await seedOpen();

    await expect(
      lifecycle.getGeneralAction({ actorUserId: OTHER, generalActionId: action.id }),
    ).rejects.toThrow(/Action not found/);
    await expect(
      lifecycle.completeGeneralAction({ actorUserId: OTHER, generalActionId: action.id }),
    ).rejects.toThrow(/Action not found/);
    await expect(
      lifecycle.editGeneralAction({
        actorUserId: OTHER,
        generalActionId: action.id,
        edit: { title: "hijack" },
      }),
    ).rejects.toThrow(/Action not found/);
  });

  it("scopes active listing and history to the owner", async () => {
    const { lifecycle, seedOpen } = await setup();
    const action = await seedOpen();

    await expect(lifecycle.listActiveGeneralActions({ ownerUserId: OTHER })).resolves.toEqual([]);
    await expect(
      lifecycle.listGeneralActionHistory({ actorUserId: OTHER, generalActionId: action.id }),
    ).resolves.toEqual([]);
  });
});

describe("asset hints", () => {
  it("carries lightweight asset hints on create without any asset record", async () => {
    const { lifecycle } = await setup();

    const action = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Replace the refrigerator water filter",
      assetHints: [{ label: "refrigerator water filter" }, { label: "model MWF" }],
    });

    expect(action.assetHints).toEqual([
      { label: "refrigerator water filter" },
      { label: "model MWF" },
    ]);
    // A hint is just a label — nothing about it turns the Action into a durable
    // asset record; it is still an ordinary open General Action.
    expect(action.status).toBe("open");
  });

  it("edits asset hints in place and records the change", async () => {
    const { lifecycle, seedOpen } = await setup();
    const action = await seedOpen();

    const edited = await lifecycle.editGeneralAction({
      actorUserId: OWNER,
      generalActionId: action.id,
      edit: { assetHints: [{ label: "car registration" }] },
    });
    expect(edited.assetHints).toEqual([{ label: "car registration" }]);

    const events = await lifecycle.listGeneralActionHistory({
      actorUserId: OWNER,
      generalActionId: action.id,
    });
    expect(events.at(-1)?.detailJson).toMatchObject({ editedAssetHints: true });
  });

  it("rejects a blank asset-hint label", async () => {
    const { lifecycle } = await setup();

    await expect(
      lifecycle.createGeneralAction({
        ownerUserId: OWNER,
        title: "Order a part",
        assetHints: [{ label: "   " }],
      }),
    ).rejects.toThrow();
  });
});

describe("people links", () => {
  async function seedPerson(
    store: Awaited<ReturnType<typeof setup>>["store"],
    ownerUserId: string,
  ) {
    return store.createPerson({
      ownerUserId,
      displayName: "Mara",
      firstName: null,
      lastName: null,
      birthday: null,
      relationshipType: "friend",
      closenessLevel: 3,
      profileBlurb: null,
      source: "manual",
    });
  }

  it("links people as context on create and hydrates them for the surface", async () => {
    const { lifecycle, store } = await setup();
    const person = await seedPerson(store, OWNER);

    const action = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Buy Mara a birthday gift",
      personIds: [person.id],
    });

    expect(action.linkedPeople).toEqual([{ id: person.id, displayName: "Mara" }]);
    // A linked person is context only — the Action stays a General Action and never
    // becomes a person-centered Follow-Up (ADR 0155). It still surfaces on the
    // owner's active Actions list, keyed on the Action, not the person.
    const active = await lifecycle.listActiveGeneralActions({ ownerUserId: OWNER });
    expect(active.map((a) => a.id)).toContain(action.id);
    expect(active.find((a) => a.id === action.id)?.linkedPeople).toHaveLength(1);
  });

  it("replaces people links via setGeneralActionPeople and records the change", async () => {
    const { lifecycle, store } = await setup();
    const person = await seedPerson(store, OWNER);
    const action = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Book Mara's appointment",
    });

    const linked = await lifecycle.setGeneralActionPeople({
      actorUserId: OWNER,
      generalActionId: action.id,
      personIds: [person.id],
    });
    expect(linked.linkedPeople).toEqual([{ id: person.id, displayName: "Mara" }]);

    const cleared = await lifecycle.setGeneralActionPeople({
      actorUserId: OWNER,
      generalActionId: action.id,
      personIds: [],
    });
    expect(cleared.linkedPeople).toEqual([]);

    const events = await lifecycle.listGeneralActionHistory({
      actorUserId: OWNER,
      generalActionId: action.id,
    });
    expect(events.at(-1)?.detailJson).toMatchObject({ editedPeople: true, peopleLinked: 0 });
  });

  it("rejects linking a person the owner does not own", async () => {
    const { lifecycle, store } = await setup();
    const theirPerson = await seedPerson(store, OTHER);

    await expect(
      lifecycle.createGeneralAction({
        ownerUserId: OWNER,
        title: "Sneaky link",
        personIds: [theirPerson.id],
      }),
    ).rejects.toThrow(/only link your own people/);
  });
});

describe("household-scoped actions", () => {
  async function setupHousehold() {
    const base = await setup();
    const household = await seedHouseholdWithMembers(base.store, {
      ownerUserId: OWNER,
      name: "Household",
      members: [
        [OWNER, "owner"],
        [MEMBER, "member"],
        [OTHER_MEMBER, "member"],
      ],
    });

    const ids = async (input: { ownerUserId: string }) =>
      (await base.lifecycle.listActiveGeneralActions(input)).map((a) => a.id);

    return { ...base, household, ids };
  }

  /**
   * A member who could see a widened-scope action loses it the moment they are removed —
   * fail-closed, no residual leak. Shared by the selected-shared and household cases, which
   * differ only in how the action's audience is widened.
   */
  async function expectMemberLosesAccessAfterRemoval(
    env: Awaited<ReturnType<typeof setupHousehold>>,
    actionInput: { title: string; scope: "shared" | "household"; selectedUserIds?: string[] },
  ) {
    const { lifecycle, store, household, ids } = env;
    const action = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      householdId: household.id,
      ...actionInput,
    });
    await expect(ids({ ownerUserId: MEMBER })).resolves.toContain(action.id);

    await removeHouseholdMember(store, { householdId: household.id, userId: MEMBER });

    await expect(ids({ ownerUserId: MEMBER })).resolves.toEqual([]);
  }

  it("creates private, selected-member, and household actions with creator provenance", async () => {
    const { lifecycle, household } = await setupHousehold();

    const privateAction = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Private errand",
    });
    const sharedAction = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Coordinate a gift",
      scope: "shared",
      householdId: household.id,
      selectedUserIds: [MEMBER],
    });
    const householdAction = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Household chore",
      scope: "household",
      householdId: household.id,
    });

    expect(privateAction).toMatchObject({ scope: "private", householdId: null });
    expect(sharedAction).toMatchObject({
      scope: "shared",
      householdId: household.id,
      createdByUserId: OWNER,
      lastActorUserId: OWNER,
    });
    expect(householdAction).toMatchObject({ scope: "household", householdId: household.id });
  });

  it("shows household actions to every active member but not to an outsider", async () => {
    const { lifecycle, household, ids } = await setupHousehold();
    const action = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Household-wide chore",
      scope: "household",
      householdId: household.id,
    });

    await expect(ids({ ownerUserId: OWNER })).resolves.toContain(action.id);
    await expect(ids({ ownerUserId: MEMBER })).resolves.toContain(action.id);
    await expect(ids({ ownerUserId: OTHER_MEMBER })).resolves.toContain(action.id);
    await expect(ids({ ownerUserId: OUTSIDER })).resolves.toEqual([]);
  });

  it("shows selected-member actions only to selected active members", async () => {
    const { lifecycle, household, ids } = await setupHousehold();
    const action = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Coordinate a surprise",
      scope: "shared",
      householdId: household.id,
      selectedUserIds: [MEMBER],
    });

    await expect(ids({ ownerUserId: OWNER })).resolves.toContain(action.id);
    await expect(ids({ ownerUserId: MEMBER })).resolves.toContain(action.id);
    await expect(ids({ ownerUserId: OTHER_MEMBER })).resolves.toEqual([]);
    await expect(ids({ ownerUserId: OUTSIDER })).resolves.toEqual([]);
  });

  it("never reveals another member's private action to the household owner", async () => {
    const { lifecycle, ids } = await setupHousehold();
    const memberPrivate = await lifecycle.createGeneralAction({
      ownerUserId: MEMBER,
      title: "Member's private matter",
    });

    // The household owner role grants no window into a member's private actions.
    await expect(ids({ ownerUserId: OWNER })).resolves.not.toContain(memberPrivate.id);
    await expect(
      lifecycle.getGeneralAction({ actorUserId: OWNER, generalActionId: memberPrivate.id }),
    ).rejects.toThrow(/Action not found/);
  });

  it("lets a visible member lifecycle-change a household action, preserving owner provenance", async () => {
    const { lifecycle, household } = await setupHousehold();
    const action = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Take out the recycling",
      scope: "household",
      householdId: household.id,
    });

    const completed = await lifecycle.completeGeneralAction({
      actorUserId: MEMBER,
      generalActionId: action.id,
    });

    expect(completed).toMatchObject({
      ownerUserId: OWNER,
      createdByUserId: OWNER,
      status: "completed",
      // The acting member is recorded as the actor without seizing ownership.
      lastActorUserId: MEMBER,
    });

    const events = await lifecycle.listGeneralActionHistory({
      actorUserId: MEMBER,
      generalActionId: action.id,
    });
    expect(events.find((event) => event.kind === "completed")?.actorUserId).toBe(MEMBER);
  });

  it("blocks lifecycle changes for actions the actor cannot see", async () => {
    const { lifecycle, household } = await setupHousehold();
    const action = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Just for one member",
      scope: "shared",
      householdId: household.id,
      selectedUserIds: [MEMBER],
    });

    await expect(
      lifecycle.completeGeneralAction({ actorUserId: OTHER_MEMBER, generalActionId: action.id }),
    ).rejects.toThrow(/Action not found/);
  });

  it("rejects a visible member editing an owner's action content (edit is owner-only)", async () => {
    const { lifecycle, household } = await setupHousehold();
    const action = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Household chore",
      scope: "household",
      householdId: household.id,
    });

    // MEMBER can see and complete it (a household action is actionable), but must not
    // be able to rewrite its content — authoring stays the owner's (ADR 0153).
    await expect(
      lifecycle.editGeneralAction({
        actorUserId: MEMBER,
        generalActionId: action.id,
        edit: { title: "hijacked" },
      }),
    ).rejects.toThrow(/Action not found/);

    const seen = await lifecycle.getGeneralAction({
      actorUserId: OWNER,
      generalActionId: action.id,
    });
    expect(seen.title).toBe("Household chore");
  });

  it("rejects a visible member managing an owner's people links", async () => {
    const { lifecycle, store, household } = await setupHousehold();
    const person = await store.createPerson({
      ownerUserId: OWNER,
      displayName: "Mara",
      firstName: null,
      lastName: null,
      birthday: null,
      relationshipType: "friend",
      closenessLevel: 3,
      profileBlurb: null,
      source: "manual",
    });
    const action = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Buy a gift",
      scope: "household",
      householdId: household.id,
    });

    await expect(
      lifecycle.setGeneralActionPeople({
        actorUserId: MEMBER,
        generalActionId: action.id,
        personIds: [person.id],
      }),
    ).rejects.toThrow(/Action not found/);
  });

  it("hides a selected-shared action from a member once they are removed", async () => {
    await expectMemberLosesAccessAfterRemoval(await setupHousehold(), {
      title: "Coordinate",
      scope: "shared",
      selectedUserIds: [MEMBER],
    });
  });

  it("closes history to a member removed from the household", async () => {
    const { lifecycle, store, household } = await setupHousehold();
    const action = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Household chore",
      scope: "household",
      householdId: household.id,
    });
    // While active, the member can read the action's history.
    await expect(
      lifecycle.listGeneralActionHistory({ actorUserId: MEMBER, generalActionId: action.id }),
    ).resolves.not.toEqual([]);

    await removeHouseholdMember(store, { householdId: household.id, userId: MEMBER });

    // Once removed, history closes to them — fail-closed, no residual leak.
    await expect(
      lifecycle.listGeneralActionHistory({ actorUserId: MEMBER, generalActionId: action.id }),
    ).resolves.toEqual([]);
  });

  it("hydrates audience detail: share count and household name", async () => {
    const { lifecycle, household } = await setupHousehold();
    const shared = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Coordinate",
      scope: "shared",
      householdId: household.id,
      selectedUserIds: [MEMBER, OTHER_MEMBER],
    });
    expect(shared.sharedWithCount).toBe(2);
    expect(shared.householdName).toBe("Household");

    const householdAction = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Chore",
      scope: "household",
      householdId: household.id,
    });
    expect(householdAction.sharedWithCount).toBe(0);
    expect(householdAction.householdName).toBe("Household");

    const privateAction = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Solo",
    });
    expect(privateAction.sharedWithCount).toBe(0);
    expect(privateAction.householdName).toBeNull();
  });

  it("hides shared actions from a member once they are removed from the household", async () => {
    await expectMemberLosesAccessAfterRemoval(await setupHousehold(), {
      title: "Household chore",
      scope: "household",
    });
  });

  it("requires a household to widen scope and at least one member to share", async () => {
    const { lifecycle, household } = await setupHousehold();

    await expect(
      lifecycle.createGeneralAction({
        ownerUserId: OWNER,
        title: "No household",
        scope: "household",
      }),
    ).rejects.toThrow(/needs a household/);
    await expect(
      lifecycle.createGeneralAction({
        ownerUserId: OWNER,
        title: "No members chosen",
        scope: "shared",
        householdId: household.id,
        selectedUserIds: [],
      }),
    ).rejects.toThrow(/at least one person/);
  });
});

describe("routines (recurring general actions)", () => {
  const CADENCE = { interval: 6, unit: "month" } as const;

  it("creates a Routine with a cadence and notes it in the created event", async () => {
    const { lifecycle } = await setup();
    const routine = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Replace the refrigerator water filter",
      recurrence: CADENCE,
    });

    expect(routine.recurrence).toEqual(CADENCE);
    expect(routine.status).toBe("open");
    const events = await lifecycle.listGeneralActionHistory({
      actorUserId: OWNER,
      generalActionId: routine.id,
    });
    expect(events.at(0)?.detailJson).toMatchObject({ recurring: true });
  });

  it("rolls the due date forward on completion and keeps the Routine open", async () => {
    const { lifecycle } = await setup();
    const routine = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Replace the filter",
      dueAt: new Date("2026-01-01T00:00:00Z"),
      recurrence: CADENCE,
    });

    const completed = await lifecycle.completeGeneralAction({
      actorUserId: OWNER,
      generalActionId: routine.id,
    });

    // Not terminal: it stays open, comes back next cycle, and never marks a completion
    // timestamp on the record (that lives in history instead).
    expect(completed.status).toBe("open");
    expect(completed.completedAt).toBeNull();
    // Rolled forward from the completion moment (now), so the next due is in the future.
    expect(completed.dueAt).toBeInstanceOf(Date);
    expect(completed.dueAt?.getTime()).toBeGreaterThan(Date.now());
    // It is still active, not resolved.
    const active = await lifecycle.listActiveGeneralActions({ ownerUserId: OWNER });
    expect(active.map((a) => a.id)).toContain(routine.id);
    const resolved = await lifecycle.listResolvedGeneralActions({ ownerUserId: OWNER });
    expect(resolved.map((a) => a.id)).not.toContain(routine.id);
  });

  it("preserves completion history across occurrences", async () => {
    const { lifecycle, historyKinds } = await setup();
    const routine = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Water the plants",
      recurrence: { interval: 1, unit: "week" },
    });

    await lifecycle.completeGeneralAction({ actorUserId: OWNER, generalActionId: routine.id });
    await lifecycle.completeGeneralAction({ actorUserId: OWNER, generalActionId: routine.id });

    // Each occurrence's completion is retained — the trail grows, nothing is lost.
    await expect(historyKinds(routine.id)).resolves.toEqual(["created", "completed", "completed"]);
    const events = await lifecycle.listGeneralActionHistory({
      actorUserId: OWNER,
      generalActionId: routine.id,
    });
    expect(events.at(-1)?.detailJson).toMatchObject({ rolledForward: true });
  });

  it("skips one Routine occurrence, records it distinctly, and keeps the Routine active", async () => {
    const { lifecycle, historyKinds } = await setup();
    const routine = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Water the plants",
      dueAt: new Date("2026-01-01T00:00:00Z"),
      recurrence: { interval: 1, unit: "week" },
    });

    const skipped = await lifecycle.skipGeneralActionOccurrence({
      actorUserId: OWNER,
      generalActionId: routine.id,
    });

    expect(skipped.status).toBe("open");
    expect(skipped.dueAt?.getTime()).toBeGreaterThan(Date.now());
    await expect(historyKinds(routine.id)).resolves.toEqual(["created", "skipped"]);
  });

  it("rejects skipping a one-time Action", async () => {
    const { lifecycle, seedOpen } = await setup();
    const action = await seedOpen();

    await expect(
      lifecycle.skipGeneralActionOccurrence({ actorUserId: OWNER, generalActionId: action.id }),
    ).rejects.toThrow(/Only a Routine occurrence/);
  });

  it("lets a household member complete a shared Routine occurrence, rolling it forward under the owner", async () => {
    const base = await setup();
    const household = await seedHouseholdWithMembers(base.store, {
      ownerUserId: OWNER,
      name: "Household",
      members: [
        [OWNER, "owner"],
        [MEMBER, "member"],
      ],
    });
    const routine = await base.lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Take out the recycling",
      scope: "household",
      householdId: household.id,
      recurrence: { interval: 1, unit: "week" },
    });

    const completed = await base.lifecycle.completeGeneralAction({
      actorUserId: MEMBER,
      generalActionId: routine.id,
    });

    // Ownership and provenance hold: the member is the actor, the owner stays owner,
    // and the Routine rolled forward rather than resolving.
    expect(completed).toMatchObject({ ownerUserId: OWNER, status: "open" });
    expect(completed.lastActorUserId).toBe(MEMBER);
    const events = await base.lifecycle.listGeneralActionHistory({
      actorUserId: MEMBER,
      generalActionId: routine.id,
    });
    expect(events.at(-1)).toMatchObject({ kind: "completed", actorUserId: MEMBER });
  });

  it("lets a household member pause and resume a shared Routine, stamping the actor", async () => {
    const base = await setup();
    const household = await seedHouseholdWithMembers(base.store, {
      ownerUserId: OWNER,
      name: "Household",
      members: [
        [OWNER, "owner"],
        [MEMBER, "member"],
      ],
    });
    const routine = await base.lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Refill the water softener",
      scope: "household",
      householdId: household.id,
      recurrence: { interval: 1, unit: "month" },
    });

    // A member who can see a household Routine may pause/resume it (act-not-author,
    // #180), keyed on the owner while recording the member as actor.
    const paused = await base.lifecycle.pauseGeneralAction({
      actorUserId: MEMBER,
      generalActionId: routine.id,
    });
    expect(paused).toMatchObject({ ownerUserId: OWNER, status: "paused", lastActorUserId: MEMBER });

    const resumed = await base.lifecycle.resumeGeneralAction({
      actorUserId: MEMBER,
      generalActionId: routine.id,
    });
    expect(resumed).toMatchObject({ ownerUserId: OWNER, status: "open", lastActorUserId: MEMBER });

    const events = await base.lifecycle.listGeneralActionHistory({
      actorUserId: MEMBER,
      generalActionId: routine.id,
    });
    expect(events.map((event) => [event.kind, event.actorUserId])).toEqual([
      ["created", OWNER],
      ["paused", MEMBER],
      ["resumed", MEMBER],
    ]);
  });

  it("pauses and resumes a Routine, keeping it out of the active list while paused", async () => {
    const { lifecycle } = await setup();
    const routine = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Rotate the mattress",
      recurrence: { interval: 3, unit: "month" },
    });

    const paused = await lifecycle.pauseGeneralAction({
      actorUserId: OWNER,
      generalActionId: routine.id,
    });
    expect(paused.status).toBe("paused");
    await expect(lifecycle.listActiveGeneralActions({ ownerUserId: OWNER })).resolves.toEqual([]);
    await expect(lifecycle.listPausedGeneralActions({ ownerUserId: OWNER })).resolves.toMatchObject(
      [{ id: routine.id }],
    );

    const resumed = await lifecycle.resumeGeneralAction({
      actorUserId: OWNER,
      generalActionId: routine.id,
    });
    expect(resumed.status).toBe("open");
    await expect(lifecycle.listPausedGeneralActions({ ownerUserId: OWNER })).resolves.toEqual([]);
  });

  it("rolls an overdue paused Routine forward on resume instead of re-surfacing it as overdue", async () => {
    const { lifecycle } = await setup();
    const routine = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Change the HVAC filter",
      // Due well in the past, then paused across that due date.
      dueAt: new Date("2020-01-01T00:00:00Z"),
      recurrence: { interval: 1, unit: "month" },
    });
    await lifecycle.pauseGeneralAction({ actorUserId: OWNER, generalActionId: routine.id });

    const resumed = await lifecycle.resumeGeneralAction({
      actorUserId: OWNER,
      generalActionId: routine.id,
    });

    expect(resumed.status).toBe("open");
    // The deliberately paused gap is not a missed occurrence: the due date is rolled
    // forward from now, so the resumed Routine reads as next-due, never overdue.
    expect(resumed.dueAt?.getTime()).toBeGreaterThan(Date.now());
    const events = await lifecycle.listGeneralActionHistory({
      actorUserId: OWNER,
      generalActionId: routine.id,
    });
    expect(events.at(-1)).toMatchObject({ kind: "resumed" });
    expect(events.at(-1)?.detailJson).toMatchObject({ rolledForward: true });
  });

  it("leaves a future-dated Routine's due date untouched on resume", async () => {
    const { lifecycle } = await setup();
    const future = new Date(Date.now() + 30 * 86_400_000);
    const routine = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Quarterly review",
      dueAt: future,
      recurrence: { interval: 3, unit: "month" },
    });
    await lifecycle.pauseGeneralAction({ actorUserId: OWNER, generalActionId: routine.id });

    const resumed = await lifecycle.resumeGeneralAction({
      actorUserId: OWNER,
      generalActionId: routine.id,
    });
    // Only overdue dates are rolled; a still-future one is preserved as chosen.
    expect(resumed.dueAt?.toISOString()).toBe(future.toISOString());
  });

  it("clears a resurface date when a deferred Routine is paused, then resumed", async () => {
    const { lifecycle } = await setup();
    const routine = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Water the garden",
      recurrence: { interval: 1, unit: "week" },
    });
    // Defer the Routine, giving it a resurface date, then pause it.
    await lifecycle.deferGeneralAction({
      actorUserId: OWNER,
      generalActionId: routine.id,
      deferUntil: new Date("2027-01-01T00:00:00Z"),
    });
    const paused = await lifecycle.pauseGeneralAction({
      actorUserId: OWNER,
      generalActionId: routine.id,
    });
    // Pausing leaves `deferred`, so it must clear the resurface date like the other
    // deferred-leaving transitions — a stale value would corrupt surfacing order.
    expect(paused.status).toBe("paused");
    expect(paused.deferUntil).toBeNull();

    const resumed = await lifecycle.resumeGeneralAction({
      actorUserId: OWNER,
      generalActionId: routine.id,
    });
    expect(resumed.status).toBe("open");
    expect(resumed.deferUntil).toBeNull();
  });

  it("refuses to remove a paused Routine's cadence in place", async () => {
    const { lifecycle } = await setup();
    const routine = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Rotate the tires",
      recurrence: { interval: 6, unit: "month" },
    });
    await lifecycle.pauseGeneralAction({ actorUserId: OWNER, generalActionId: routine.id });

    // Turning a paused Routine one-time would leave a paused one-time Action — blocked.
    await expect(
      lifecycle.editGeneralAction({
        actorUserId: OWNER,
        generalActionId: routine.id,
        edit: { recurrence: null },
      }),
    ).rejects.toThrow(/Resume this routine/);
    // The invariant holds: it is still a paused Routine.
    const still = await lifecycle.getGeneralAction({
      actorUserId: OWNER,
      generalActionId: routine.id,
    });
    expect(still.status).toBe("paused");
    expect(still.recurrence).toEqual({ interval: 6, unit: "month" });
  });

  it("refuses to pause a one-time Action", async () => {
    const { lifecycle, seedOpen } = await setup();
    const action = await seedOpen();

    await expect(
      lifecycle.pauseGeneralAction({ actorUserId: OWNER, generalActionId: action.id }),
    ).rejects.toThrow(/Only a routine can be paused/);
  });

  it("cannot complete a paused Routine — it must be resumed first", async () => {
    const { lifecycle } = await setup();
    const routine = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Deep clean",
      recurrence: { interval: 1, unit: "month" },
    });
    await lifecycle.pauseGeneralAction({ actorUserId: OWNER, generalActionId: routine.id });

    await expect(
      lifecycle.completeGeneralAction({ actorUserId: OWNER, generalActionId: routine.id }),
    ).rejects.toThrow(/Cannot complete/);
  });

  it("archives a paused Routine and records history", async () => {
    const { lifecycle, historyKinds } = await setup();
    const routine = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Old subscription review",
      recurrence: { interval: 1, unit: "year" },
    });
    await lifecycle.pauseGeneralAction({ actorUserId: OWNER, generalActionId: routine.id });

    const archived = await lifecycle.archiveGeneralAction({
      actorUserId: OWNER,
      generalActionId: routine.id,
    });
    expect(archived.status).toBe("archived");
    await expect(historyKinds(routine.id)).resolves.toEqual(["created", "paused", "archived"]);
  });

  it("edits a one-time Action into a Routine and back via cadence", async () => {
    const { lifecycle, seedOpen } = await setup();
    const action = await seedOpen();
    expect(action.recurrence).toBeNull();

    const madeRoutine = await lifecycle.editGeneralAction({
      actorUserId: OWNER,
      generalActionId: action.id,
      edit: { recurrence: { interval: 2, unit: "week" } },
    });
    expect(madeRoutine.recurrence).toEqual({ interval: 2, unit: "week" });

    const backToOneTime = await lifecycle.editGeneralAction({
      actorUserId: OWNER,
      generalActionId: action.id,
      edit: { recurrence: null },
    });
    expect(backToOneTime.recurrence).toBeNull();
  });
});

describe("visibility transitions", () => {
  async function setupHousehold() {
    const base = await setup();
    const household = await base.store.createHouseholdWorkspace({
      ownerUserId: OWNER,
      name: "Household",
      defaultScope: "private",
    });
    for (const [userId, role] of [
      [OWNER, "owner"],
      [MEMBER, "member"],
      [OTHER_MEMBER, "member"],
    ] as const) {
      await base.store.createHouseholdMembership({
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
    const ids = async (input: { ownerUserId: string }) =>
      (await base.lifecycle.listActiveGeneralActions(input)).map((a) => a.id);
    return { ...base, household, ids };
  }

  it("widens a private action to household and records the change", async () => {
    const { lifecycle, household, ids } = await setupHousehold();
    const action = await lifecycle.createGeneralAction({ ownerUserId: OWNER, title: "Errand" });

    await expect(ids({ ownerUserId: MEMBER })).resolves.not.toContain(action.id);

    const widened = await lifecycle.setGeneralActionVisibility({
      actorUserId: OWNER,
      generalActionId: action.id,
      scope: "household",
      householdId: household.id,
    });
    expect(widened).toMatchObject({ scope: "household", householdId: household.id });

    await expect(ids({ ownerUserId: MEMBER })).resolves.toContain(action.id);
    const events = await lifecycle.listGeneralActionHistory({
      actorUserId: OWNER,
      generalActionId: action.id,
    });
    expect(events.at(-1)?.detailJson).toMatchObject({
      editedVisibility: true,
      scope: "household",
      previousScope: "private",
    });
  });

  it("narrows a household action back to private and hides it, fail-closed", async () => {
    const { lifecycle, household, ids } = await setupHousehold();
    const action = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Chore",
      scope: "household",
      householdId: household.id,
    });
    await expect(ids({ ownerUserId: MEMBER })).resolves.toContain(action.id);

    const narrowed = await lifecycle.setGeneralActionVisibility({
      actorUserId: OWNER,
      generalActionId: action.id,
      scope: "private",
    });
    expect(narrowed).toMatchObject({ scope: "private", householdId: null });
    await expect(ids({ ownerUserId: MEMBER })).resolves.not.toContain(action.id);
  });

  it("drops a member's visibility when re-selecting a shared audience (stale shares cleared)", async () => {
    const { lifecycle, household, ids } = await setupHousehold();
    const action = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Coordinate",
      scope: "shared",
      householdId: household.id,
      selectedUserIds: [MEMBER],
    });
    await expect(ids({ ownerUserId: MEMBER })).resolves.toContain(action.id);

    // Re-share with only OTHER_MEMBER — MEMBER must lose visibility, never keep it.
    await lifecycle.setGeneralActionVisibility({
      actorUserId: OWNER,
      generalActionId: action.id,
      scope: "shared",
      householdId: household.id,
      selectedUserIds: [OTHER_MEMBER],
    });

    await expect(ids({ ownerUserId: MEMBER })).resolves.not.toContain(action.id);
    await expect(ids({ ownerUserId: OTHER_MEMBER })).resolves.toContain(action.id);
  });

  it("closes history to a member narrowed out of a shared action", async () => {
    const { lifecycle, household } = await setupHousehold();
    const action = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Coordinate",
      scope: "shared",
      householdId: household.id,
      selectedUserIds: [MEMBER],
    });
    // MEMBER is in the audience, so history is visible to them.
    await expect(
      lifecycle.listGeneralActionHistory({ actorUserId: MEMBER, generalActionId: action.id }),
    ).resolves.not.toEqual([]);

    // Re-select the audience to exclude MEMBER — their history access closes with
    // their visibility, fail-closed.
    await lifecycle.setGeneralActionVisibility({
      actorUserId: OWNER,
      generalActionId: action.id,
      scope: "shared",
      householdId: household.id,
      selectedUserIds: [OTHER_MEMBER],
    });

    await expect(
      lifecycle.listGeneralActionHistory({ actorUserId: MEMBER, generalActionId: action.id }),
    ).resolves.toEqual([]);
  });

  it("lets only the owner re-scope — a visible member cannot widen or narrow", async () => {
    const { lifecycle, household } = await setupHousehold();
    const action = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Household chore",
      scope: "household",
      householdId: household.id,
    });

    // MEMBER can see and act on it, but must not be able to re-scope it.
    await expect(
      lifecycle.setGeneralActionVisibility({
        actorUserId: MEMBER,
        generalActionId: action.id,
        scope: "private",
      }),
    ).rejects.toThrow(/Action not found/);
  });
});
