import { describe, expect, it } from "vitest";
import { removeHouseholdMember, seedHouseholdWithMembers } from "../households/household-fixtures";
import { createInMemoryGeneralActionLifecycleStore } from "./in-memory-store";
import { createGeneralActionLifecycle } from "./lifecycle";

/**
 * The Phase Eight collaboration contract for household Actions and Routines,
 * exercised across a real multi-member household rather than one actor.
 *
 * Two members and an outsider, because every rule here is about the difference
 * between them: what a member-owned record keeps from its owner, what a
 * household-native one hands to everybody, and what neither gives away.
 */
const OWNER = "user-owner";
const MEMBER = "user-member";
const OUTSIDER = "user-outsider";

async function household() {
  const store = createInMemoryGeneralActionLifecycleStore();
  const lifecycle = createGeneralActionLifecycle(store);
  const workspace = await seedHouseholdWithMembers(store, {
    ownerUserId: OWNER,
    name: "Home",
    members: [
      [OWNER, "owner"],
      [MEMBER, "member"],
    ],
  });

  /** The household's own chore: workspace-owned, everyone's to act on. */
  const seedHouseholdNative = (
    overrides: {
      createdBy?: string;
      title?: string;
      recurrence?: { interval: number; unit: "day" | "week" | "month" | "year" } | null;
      dueAt?: Date | null;
      responsibilityHolderUserId?: string | null;
    } = {},
  ) =>
    lifecycle.createGeneralAction({
      ownerUserId: overrides.createdBy ?? OWNER,
      title: overrides.title ?? "Put the bins out",
      ownership: "household_native",
      householdId: workspace.id,
      recurrence: overrides.recurrence ?? null,
      dueAt: overrides.dueAt ?? null,
      responsibilityHolderUserId: overrides.responsibilityHolderUserId ?? null,
    });

  /** "My errand, which you can see": owned by OWNER, visible household-wide. */
  const seedMemberOwnedShared = (overrides: { title?: string } = {}) =>
    lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: overrides.title ?? "My dentist appointment",
      scope: "household",
      householdId: workspace.id,
    });

  return { store, lifecycle, workspace, seedHouseholdNative, seedMemberOwnedShared };
}

const UNAVAILABLE = /no longer available/;

describe("creating a household-native record", () => {
  it("belongs to the workspace, is visible household-wide, and keeps its creator as provenance only", async () => {
    const { lifecycle, workspace, seedHouseholdNative } = await household();

    const chore = await seedHouseholdNative({ createdBy: MEMBER });

    expect(chore).toMatchObject({
      ownership: "household_native",
      scope: "household",
      householdId: workspace.id,
      createdByUserId: MEMBER,
      responsibilityHolderUserId: null,
      occurrenceVersion: 0,
    });
    // Visible to the other member without any share row, by definition.
    await expect(
      lifecycle.getGeneralAction({ actorUserId: OWNER, generalActionId: chore.id }),
    ).resolves.toMatchObject({ id: chore.id });
  });

  it("refuses the personal filing a workspace-owned record cannot hold", async () => {
    const { lifecycle, workspace } = await household();

    await expect(
      lifecycle.createGeneralAction({
        ownerUserId: OWNER,
        title: "Replace the water filter",
        ownership: "household_native",
        householdId: workspace.id,
        areaId: "00000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow(/Areas are personal/);
  });

  it("stays out of reach of someone who is not in the household", async () => {
    const { lifecycle, seedHouseholdNative } = await household();
    const chore = await seedHouseholdNative();

    await expect(
      lifecycle.getGeneralAction({ actorUserId: OUTSIDER, generalActionId: chore.id }),
    ).rejects.toThrow(UNAVAILABLE);
  });
});

describe("symmetric authority over the household's own records", () => {
  it("lets any active member edit, pause, skip, defer, and archive it", async () => {
    const { lifecycle, seedHouseholdNative } = await household();
    const chore = await seedHouseholdNative({
      createdBy: OWNER,
      recurrence: { interval: 1, unit: "week" },
      dueAt: new Date("2026-08-11T00:00:00Z"),
    });

    const edited = await lifecycle.editGeneralAction({
      actorUserId: MEMBER,
      generalActionId: chore.id,
      edit: { notes: "Green bin this week" },
    });
    expect(edited).toMatchObject({ notes: "Green bin this week", lastActorUserId: MEMBER });

    const skipped = await lifecycle.skipGeneralActionOccurrence({
      actorUserId: MEMBER,
      generalActionId: chore.id,
    });
    expect(skipped.reconciliation).toBeNull();

    const paused = await lifecycle.pauseGeneralAction({
      actorUserId: MEMBER,
      generalActionId: chore.id,
    });
    expect(paused).toMatchObject({ status: "paused", lastActorUserId: MEMBER });

    await lifecycle.resumeGeneralAction({ actorUserId: MEMBER, generalActionId: chore.id });
    const archived = await lifecycle.archiveGeneralAction({
      actorUserId: MEMBER,
      generalActionId: chore.id,
    });
    expect(archived).toMatchObject({ status: "archived", lastActorUserId: MEMBER });
  });

  it("gives its creator no privilege the other member lacks", async () => {
    const { lifecycle, seedHouseholdNative } = await household();
    const chore = await seedHouseholdNative({ createdBy: OWNER });

    // The Household Owner role and the record's creator are the same person
    // here, and neither buys anything: the member's edit lands identically.
    await expect(
      lifecycle.editGeneralAction({
        actorUserId: MEMBER,
        generalActionId: chore.id,
        edit: { title: "Put the bins out on Tuesday" },
      }),
    ).resolves.toMatchObject({ title: "Put the bins out on Tuesday" });
  });

  it("refuses to re-address a record the household already owns", async () => {
    const { lifecycle, workspace, seedHouseholdNative } = await household();
    const chore = await seedHouseholdNative();

    await expect(
      lifecycle.setGeneralActionVisibility({
        actorUserId: OWNER,
        generalActionId: chore.id,
        scope: "shared",
        householdId: workspace.id,
        selectedUserIds: [MEMBER],
      }),
    ).rejects.toThrow(/already there for everyone/);
  });
});

describe("what a member-owned record keeps from its owner", () => {
  it("narrows a collaborator to the reversible progress actions", async () => {
    const { lifecycle, seedMemberOwnedShared } = await household();
    const errand = await seedMemberOwnedShared();

    // "I picked up the milk" is a truthful report about someone else's record.
    const completed = await lifecycle.completeGeneralAction({
      actorUserId: MEMBER,
      generalActionId: errand.id,
    });
    expect(completed).toMatchObject({ status: "completed", lastActorUserId: MEMBER });
    await expect(
      lifecycle.reopenGeneralAction({ actorUserId: MEMBER, generalActionId: errand.id }),
    ).resolves.toMatchObject({ status: "open" });

    // Everything that re-authors or retires it returns to the owner.
    for (const attempt of [
      () =>
        lifecycle.editGeneralAction({
          actorUserId: MEMBER,
          generalActionId: errand.id,
          edit: { title: "Rewritten" },
        }),
      () => lifecycle.archiveGeneralAction({ actorUserId: MEMBER, generalActionId: errand.id }),
      () => lifecycle.dismissGeneralAction({ actorUserId: MEMBER, generalActionId: errand.id }),
      () =>
        lifecycle.deferGeneralAction({
          actorUserId: MEMBER,
          generalActionId: errand.id,
          deferUntil: new Date("2026-09-01T00:00:00Z"),
        }),
    ]) {
      await expect(attempt()).rejects.toThrow(UNAVAILABLE);
    }
  });

  it("has no Responsibility Holder to name", async () => {
    const { lifecycle, seedMemberOwnedShared } = await household();
    const errand = await seedMemberOwnedShared();

    await expect(
      lifecycle.setResponsibilityHolder({
        actorUserId: OWNER,
        generalActionId: errand.id,
        holderUserId: MEMBER,
      }),
    ).rejects.toThrow(/Only a household action names/);
  });
});

describe("one authoritative occurrence", () => {
  it("advances once when two members complete the same occurrence, and tells the second what happened", async () => {
    const { lifecycle, seedHouseholdNative } = await household();
    const routine = await seedHouseholdNative({
      recurrence: { interval: 1, unit: "week" },
      dueAt: new Date("2026-08-11T00:00:00Z"),
    });

    // Both members render the same occurrence and both act against it.
    const seenVersion = routine.occurrenceVersion;
    const first = await lifecycle.completeGeneralAction({
      actorUserId: OWNER,
      generalActionId: routine.id,
      expectedOccurrenceVersion: seenVersion,
    });
    const second = await lifecycle.completeGeneralAction({
      actorUserId: MEMBER,
      generalActionId: routine.id,
      expectedOccurrenceVersion: seenVersion,
    });

    expect(first.reconciliation).toBeNull();
    expect(second.reconciliation).toMatchObject({
      handledAs: "completed",
      handledByUserId: OWNER,
    });
    // One roll-forward, not two, and one completion in history.
    expect(second.occurrenceVersion).toBe(seenVersion + 1);
    expect(second.dueAt?.getTime()).toBe(first.dueAt?.getTime());
    const history = await lifecycle.listGeneralActionHistory({
      actorUserId: MEMBER,
      generalActionId: routine.id,
    });
    expect(history.filter((event) => event.kind === "completed")).toHaveLength(1);
  });

  it("records a skip as a skip and never as a completion", async () => {
    const { lifecycle, seedHouseholdNative } = await household();
    const routine = await seedHouseholdNative({
      recurrence: { interval: 1, unit: "week" },
      dueAt: new Date("2026-08-11T00:00:00Z"),
    });

    const skipped = await lifecycle.skipGeneralActionOccurrence({
      actorUserId: MEMBER,
      generalActionId: routine.id,
      expectedOccurrenceVersion: routine.occurrenceVersion,
    });
    const stale = await lifecycle.completeGeneralAction({
      actorUserId: OWNER,
      generalActionId: routine.id,
      expectedOccurrenceVersion: routine.occurrenceVersion,
    });

    expect(skipped.status).toBe("open");
    expect(stale.reconciliation).toMatchObject({ handledAs: "skipped", handledByUserId: MEMBER });
    const history = await lifecycle.listGeneralActionHistory({
      actorUserId: OWNER,
      generalActionId: routine.id,
    });
    expect(history.map((event) => event.kind)).toEqual(["created", "skipped"]);
  });
});

describe("the Responsibility Holder", () => {
  it("is an optional name any member may set, and gates nothing", async () => {
    const { lifecycle, seedHouseholdNative } = await household();
    const chore = await seedHouseholdNative();

    expect(chore.responsibilityHolderUserId).toBeNull();

    const named = await lifecycle.setResponsibilityHolder({
      actorUserId: MEMBER,
      generalActionId: chore.id,
      holderUserId: OWNER,
    });
    expect(named.responsibilityHolderUserId).toBe(OWNER);

    // The member who is not named still holds full authority over it.
    await expect(
      lifecycle.editGeneralAction({
        actorUserId: MEMBER,
        generalActionId: chore.id,
        edit: { notes: "Tuesday nights" },
      }),
    ).resolves.toMatchObject({ notes: "Tuesday nights" });
  });

  it("never moves on its own when an occurrence is completed or skipped", async () => {
    const { lifecycle, seedHouseholdNative } = await household();
    const routine = await seedHouseholdNative({
      recurrence: { interval: 1, unit: "week" },
      dueAt: new Date("2026-08-11T00:00:00Z"),
      responsibilityHolderUserId: MEMBER,
    });

    const completed = await lifecycle.completeGeneralAction({
      actorUserId: OWNER,
      generalActionId: routine.id,
    });
    const skipped = await lifecycle.skipGeneralActionOccurrence({
      actorUserId: OWNER,
      generalActionId: routine.id,
    });

    // Tendnote asserting whose turn it is next would be a claim about the past
    // it cannot observe, so the name stays exactly where the household put it.
    expect(completed.responsibilityHolderUserId).toBe(MEMBER);
    expect(skipped.responsibilityHolderUserId).toBe(MEMBER);
  });

  it("records a hand-off as an explicit act with its actor", async () => {
    const { lifecycle, seedHouseholdNative } = await household();
    const chore = await seedHouseholdNative({ responsibilityHolderUserId: OWNER });

    const handed = await lifecycle.setResponsibilityHolder({
      actorUserId: OWNER,
      generalActionId: chore.id,
      holderUserId: MEMBER,
      handedOff: true,
    });
    expect(handed.responsibilityHolderUserId).toBe(MEMBER);

    const history = await lifecycle.listGeneralActionHistory({
      actorUserId: MEMBER,
      generalActionId: chore.id,
    });
    const change = history.at(-1);
    expect(change).toMatchObject({ kind: "responsibility_changed", actorUserId: OWNER });
    expect(change?.detailJson).toMatchObject({
      previousHolderUserId: OWNER,
      holderUserId: MEMBER,
      handedOff: true,
    });
  });

  it("refuses a name that is not an active member of this household", async () => {
    const { lifecycle, seedHouseholdNative } = await household();
    const chore = await seedHouseholdNative();

    await expect(
      lifecycle.setResponsibilityHolder({
        actorUserId: OWNER,
        generalActionId: chore.id,
        holderUserId: OUTSIDER,
      }),
    ).rejects.toThrow(/currently in this household/);
  });
});

describe("handing a member-owned record to the household", () => {
  it("transfers ownership in place, keeps its history, and has no way back", async () => {
    const { lifecycle, seedMemberOwnedShared } = await household();
    const errand = await seedMemberOwnedShared({ title: "Renew the parking permit" });

    const handed = await lifecycle.handGeneralActionToHousehold({
      actorUserId: OWNER,
      generalActionId: errand.id,
      responsibilityHolderUserId: MEMBER,
    });

    expect(handed).toMatchObject({
      ownership: "household_native",
      scope: "household",
      createdByUserId: OWNER,
      responsibilityHolderUserId: MEMBER,
    });
    // The other member now holds full authority over what used to be an errand.
    await expect(
      lifecycle.archiveGeneralAction({ actorUserId: MEMBER, generalActionId: errand.id }),
    ).resolves.toMatchObject({ status: "archived" });
    // And nobody can take it back, its former owner included.
    await expect(
      lifecycle.handGeneralActionToHousehold({
        actorUserId: OWNER,
        generalActionId: errand.id,
      }),
    ).rejects.toThrow(/already there for everyone/);
  });

  it("is refused to a member who does not own the record", async () => {
    const { lifecycle, seedMemberOwnedShared } = await household();
    const errand = await seedMemberOwnedShared();

    await expect(
      lifecycle.handGeneralActionToHousehold({
        actorUserId: MEMBER,
        generalActionId: errand.id,
      }),
    ).rejects.toThrow(UNAVAILABLE);
  });
});

describe("departure", () => {
  it("ends the departed member's access while the household keeps the record and its history", async () => {
    const { store, lifecycle, workspace, seedHouseholdNative } = await household();
    // The member creates the chore, so their user id is also its storage key —
    // the case where treating `ownerUserId` as an access path would be worst.
    const chore = await seedHouseholdNative({ createdBy: MEMBER, title: "Water the plants" });
    await lifecycle.completeGeneralAction({ actorUserId: MEMBER, generalActionId: chore.id });

    await removeHouseholdMember(store, { householdId: workspace.id, userId: MEMBER });

    await expect(
      lifecycle.getGeneralAction({ actorUserId: MEMBER, generalActionId: chore.id }),
    ).rejects.toThrow(UNAVAILABLE);
    await expect(
      lifecycle.editGeneralAction({
        actorUserId: MEMBER,
        generalActionId: chore.id,
        edit: { title: "Mine now" },
      }),
    ).rejects.toThrow(UNAVAILABLE);

    // The household still has it, with the departed member's attribution intact.
    const kept = await lifecycle.getGeneralAction({
      actorUserId: OWNER,
      generalActionId: chore.id,
    });
    expect(kept).toMatchObject({ createdByUserId: MEMBER, ownership: "household_native" });
    const history = await lifecycle.listGeneralActionHistory({
      actorUserId: OWNER,
      generalActionId: chore.id,
    });
    expect(history.map((event) => event.actorUserId)).toEqual([MEMBER, MEMBER]);
  });

  it("clears a departed member's name from the records that named them", async () => {
    const { store, workspace, seedHouseholdNative } = await household();
    const chore = await seedHouseholdNative({ responsibilityHolderUserId: MEMBER });

    const cleared = await store.clearResponsibilityHolderForMember({
      householdId: workspace.id,
      userId: MEMBER,
    });

    expect(cleared.map((action) => action.id)).toEqual([chore.id]);
    // No replacement is chosen. An unnamed household chore is a legitimate state.
    expect(cleared[0]?.responsibilityHolderUserId).toBeNull();
  });

  it("returns a departing member's own shared record to private and leaves the household's alone", async () => {
    const { store, workspace, seedHouseholdNative, seedMemberOwnedShared } = await household();
    const errand = await seedMemberOwnedShared();
    const chore = await seedHouseholdNative();

    const reverted = await store.revertMemberOwnedGeneralActionsToPrivate({
      householdId: workspace.id,
      ownerUserId: OWNER,
    });

    expect(reverted.map((action) => action.id)).toEqual([errand.id]);
    expect(reverted[0]).toMatchObject({ scope: "private", householdId: null });
    // A departure ends access, not the household's ownership of its own chores.
    const stillTheHousehold = await store.getGeneralAction({
      ownerUserId: OWNER,
      generalActionId: chore.id,
    });
    expect(stillTheHousehold).toMatchObject({
      ownership: "household_native",
      scope: "household",
    });
  });
});

describe("handing a private Action to the household", () => {
  it("finds the household from the actor's own membership rather than an argument", async () => {
    const { lifecycle, workspace } = await household();
    const errand = await lifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Book the boiler service",
    });
    expect(errand).toMatchObject({ scope: "private", householdId: null });

    const handed = await lifecycle.handGeneralActionToHousehold({
      actorUserId: OWNER,
      generalActionId: errand.id,
    });

    expect(handed).toMatchObject({
      ownership: "household_native",
      scope: "household",
      householdId: workspace.id,
    });
  });

  it("refuses when the actor is in no household to hand it to", async () => {
    const { lifecycle } = await household();
    const errand = await lifecycle.createGeneralAction({
      ownerUserId: OUTSIDER,
      title: "Nobody's household",
    });

    await expect(
      lifecycle.handGeneralActionToHousehold({
        actorUserId: OUTSIDER,
        generalActionId: errand.id,
      }),
    ).rejects.toThrow(/needs a household/);
  });
});

describe("history after departure", () => {
  it("shows a departed creator nothing, rather than the household's trail", async () => {
    const { store, lifecycle, workspace, seedHouseholdNative } = await household();
    const chore = await seedHouseholdNative({ createdBy: MEMBER });
    await lifecycle.completeGeneralAction({ actorUserId: OWNER, generalActionId: chore.id });

    await removeHouseholdMember(store, { householdId: workspace.id, userId: MEMBER });

    // The record is keyed under their user id and they wrote it, and neither
    // buys them a read once their membership has ended.
    await expect(
      lifecycle.listGeneralActionHistory({ actorUserId: MEMBER, generalActionId: chore.id }),
    ).resolves.toEqual([]);
    await expect(
      lifecycle.listGeneralActionHistory({ actorUserId: OWNER, generalActionId: chore.id }),
    ).resolves.toHaveLength(2);
  });
});
