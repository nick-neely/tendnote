import { describe, expect, it } from "vitest";
import { createGeneralActionAreaManager } from "../general-action-areas/lifecycle";
import { createInMemoryGeneralActionLifecycleStore } from "./in-memory-store";
import { createGeneralActionLifecycle } from "./lifecycle";

const OWNER = "user-1";
const OTHER = "user-2";

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
    (await lifecycle.listGeneralActionHistory({ ownerUserId: OWNER, generalActionId })).map(
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
        ownerUserId: OWNER,
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
      ownerUserId: OWNER,
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
      ownerUserId: OWNER,
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
      lifecycle.editGeneralAction({ ownerUserId: OWNER, generalActionId: action.id, edit: {} }),
    ).rejects.toThrow(/must change the title, notes, due date, links, or area/);
  });

  it("cannot edit a completed action", async () => {
    const { lifecycle, seedOpen } = await setup();
    const action = await seedOpen();
    await lifecycle.completeGeneralAction({ ownerUserId: OWNER, generalActionId: action.id });

    await expect(
      lifecycle.editGeneralAction({
        ownerUserId: OWNER,
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
      ownerUserId: OWNER,
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
    await lifecycle.completeGeneralAction({ ownerUserId: OWNER, generalActionId: action.id });

    const events = await lifecycle.listGeneralActionHistory({
      ownerUserId: OWNER,
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
      ownerUserId: OWNER,
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
        ownerUserId: OWNER,
        generalActionId: action.id,
        deferUntil: new Date("not a date"),
      }),
    ).rejects.toThrow(/concrete resurface date/);
  });

  it("dismisses an action", async () => {
    const { lifecycle, seedOpen, historyKinds } = await setup();
    const action = await seedOpen();

    const dismissed = await lifecycle.dismissGeneralAction({
      ownerUserId: OWNER,
      generalActionId: action.id,
    });

    expect(dismissed.status).toBe("dismissed");
    await expect(historyKinds(action.id)).resolves.toEqual(["created", "dismissed"]);
  });

  it("reopens a completed action and clears its completion time", async () => {
    const { lifecycle, seedOpen, historyKinds } = await setup();
    const action = await seedOpen();
    await lifecycle.completeGeneralAction({ ownerUserId: OWNER, generalActionId: action.id });

    const reopened = await lifecycle.reopenGeneralAction({
      ownerUserId: OWNER,
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
      ownerUserId: OWNER,
      generalActionId: action.id,
      deferUntil: new Date("2026-10-01T00:00:00Z"),
    });

    const completed = await lifecycle.completeGeneralAction({
      ownerUserId: OWNER,
      generalActionId: action.id,
    });

    expect(completed.status).toBe("completed");
    expect(completed.deferUntil).toBeNull();
  });

  it("archives an action out of active views while preserving history", async () => {
    const { store, lifecycle, seedOpen, historyKinds } = await setup();
    const action = await seedOpen();

    const archived = await lifecycle.archiveGeneralAction({
      ownerUserId: OWNER,
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
    await lifecycle.completeGeneralAction({ ownerUserId: OWNER, generalActionId: action.id });

    await expect(
      lifecycle.completeGeneralAction({ ownerUserId: OWNER, generalActionId: action.id }),
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
    await lifecycle.completeGeneralAction({ ownerUserId: OWNER, generalActionId: done.id });
    const kept = await seedOpen({ title: "Kept" });

    const active = await lifecycle.listActiveGeneralActions({ ownerUserId: OWNER });

    expect(active.map((a) => a.id)).toEqual([kept.id]);
  });

  it("lists resolved (completed + dismissed) actions but not archived ones", async () => {
    const { lifecycle, seedOpen } = await setup();
    const done = await seedOpen({ title: "Done" });
    await lifecycle.completeGeneralAction({ ownerUserId: OWNER, generalActionId: done.id });
    const dropped = await seedOpen({ title: "Dropped" });
    await lifecycle.dismissGeneralAction({ ownerUserId: OWNER, generalActionId: dropped.id });
    const filed = await seedOpen({ title: "Filed away" });
    await lifecycle.archiveGeneralAction({ ownerUserId: OWNER, generalActionId: filed.id });

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
      ownerUserId: OWNER,
      generalActionId: action.id,
      edit: { areaId: home.id },
    });
    expect(filed.areaId).toBe(home.id);

    const unfiled = await lifecycle.editGeneralAction({
      ownerUserId: OWNER,
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
      ownerUserId: OWNER,
      generalActionId: action.id,
      edit: { areaId: home.id },
    });

    await areas.archiveArea({ ownerUserId: OWNER, areaId: home.id });

    // The action keeps its area even though the area is now archived...
    const stillFiled = await lifecycle.getGeneralAction({
      ownerUserId: OWNER,
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
      ownerUserId: OWNER,
      generalActionId: action.id,
      edit: { areaId: home.id },
    });

    const events = await lifecycle.listGeneralActionHistory({
      ownerUserId: OWNER,
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
      lifecycle.getGeneralAction({ ownerUserId: OTHER, generalActionId: action.id }),
    ).rejects.toThrow(/Action not found/);
    await expect(
      lifecycle.completeGeneralAction({ ownerUserId: OTHER, generalActionId: action.id }),
    ).rejects.toThrow(/Action not found/);
    await expect(
      lifecycle.editGeneralAction({
        ownerUserId: OTHER,
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
      lifecycle.listGeneralActionHistory({ ownerUserId: OTHER, generalActionId: action.id }),
    ).resolves.toEqual([]);
  });
});
