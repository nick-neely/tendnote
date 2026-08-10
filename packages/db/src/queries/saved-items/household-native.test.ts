import { HouseholdRecordUnavailableError, SavedItemConflictError } from "@tendnote/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { removeHouseholdMember, seedHouseholdWithMembers } from "../households/household-fixtures";
import { createHouseholdSavedItemCollaboration } from "./household-native";
import { createInMemorySavedItemLifecycleStore } from "./in-memory-store";
import { createSavedItemLifecycle } from "./lifecycle";

const ANA = "ana";
const BEN = "ben";
const MARA = "mara";
const OUTSIDER = "outsider";

/**
 * One household, three active members with different roles, and one person who
 * was never in it. Every case below is about which of the four may do a thing -
 * so they are seeded once, identically, rather than each test inventing its own
 * roster and quietly testing a different household.
 */
async function seedHousehold() {
  const store = createInMemorySavedItemLifecycleStore();
  const household = await seedHouseholdWithMembers(store, {
    ownerUserId: ANA,
    members: [
      [ANA, "owner"],
      [BEN, "member"],
      [MARA, "member"],
    ],
  });
  return { store, householdId: household.id };
}

type Harness = Awaited<ReturnType<typeof seedHousehold>>;

function collaborationFor(harness: Harness) {
  return createHouseholdSavedItemCollaboration(harness.store);
}

async function seedItem(
  harness: Harness,
  overrides: { actorUserId?: string; kind?: "note" | "open_question" } = {},
) {
  return collaborationFor(harness).createHouseholdSavedItem({
    actorUserId: overrides.actorUserId ?? ANA,
    householdId: harness.householdId,
    kind: overrides.kind ?? "note",
    title: "Boiler service number",
    content: "The engineer who came out in March.",
    originalText: "Keep the boiler engineer's number where we can both find it",
  });
}

describe("creating a household-native Saved Item", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await seedHousehold();
  });

  it("belongs to the workspace rather than to whoever wrote it", async () => {
    const item = await seedItem(harness);

    expect(item).toMatchObject({
      ownership: "household_native",
      ownerUserId: null,
      scope: "household",
      householdId: harness.householdId,
      createdByUserId: ANA,
      lastActorUserId: ANA,
      version: 1,
    });
  });

  it("grounds itself in evidence the whole household can already see", async () => {
    const item = await seedItem(harness);

    await expect(
      harness.store.getSourceRecord({ ownerUserId: ANA, sourceRecordId: item.sourceRecordId }),
    ).resolves.toMatchObject({
      scope: "household",
      householdId: harness.householdId,
      content: "Keep the boiler engineer's number where we can both find it",
    });
  });

  it("refuses to stand a whole-household record on one member's private evidence", async () => {
    const source = await harness.store.createSourceRecord({
      ownerUserId: ANA,
      sourceType: "manual",
      content: "Something I only wrote for myself",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "high",
      sensitivity: "normal",
      scope: "private",
      householdId: null,
      importance: 3,
      metadataJson: {},
    });

    await expect(
      collaborationFor(harness).createHouseholdSavedItem({
        actorUserId: ANA,
        householdId: harness.householdId,
        kind: "note",
        title: "Boiler service number",
        sourceRecordId: source.id,
      }),
    ).rejects.toThrow("evidence the whole household can already see");
  });

  it("refuses someone who is not an active member, without saying why", async () => {
    await expect(
      collaborationFor(harness).createHouseholdSavedItem({
        actorUserId: OUTSIDER,
        householdId: harness.householdId,
        kind: "note",
        title: "Boiler service number",
      }),
    ).rejects.toBeInstanceOf(HouseholdRecordUnavailableError);
  });
});

describe("household-native authority is symmetric", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await seedHousehold();
  });

  // Ana created it and holds the Owner role; Ben and Mara hold neither. If any
  // of the three could do something the others could not, the record would have
  // an owner in all but name (ADR 0214).
  it.each([ANA, BEN, MARA])("%s can edit an item Ana created", async (actorUserId) => {
    const item = await seedItem(harness);

    const edited = await collaborationFor(harness).editHouseholdSavedItem({
      actorUserId,
      savedItemId: item.id,
      expectedVersion: item.version,
      edit: { title: "Boiler engineer" },
    });

    expect(edited).toMatchObject({
      title: "Boiler engineer",
      createdByUserId: ANA,
      lastActorUserId: actorUserId,
      ownerUserId: null,
    });
  });

  it.each([ANA, BEN, MARA])("%s can archive and restore it", async (actorUserId) => {
    const item = await seedItem(harness);
    const collaboration = collaborationFor(harness);

    const archived = await collaboration.archiveHouseholdSavedItem({
      actorUserId,
      savedItemId: item.id,
      expectedVersion: item.version,
    });
    expect(archived).toMatchObject({ status: "archived", lastActorUserId: actorUserId });

    const restored = await collaboration.restoreHouseholdSavedItem({
      actorUserId,
      savedItemId: item.id,
      expectedVersion: archived.version,
    });
    expect(restored).toMatchObject({ status: "active", lastActorUserId: actorUserId });
  });

  it("lets any member resolve an open question the household asked", async () => {
    const item = await seedItem(harness, { actorUserId: BEN, kind: "open_question" });

    const resolved = await collaborationFor(harness).resolveHouseholdSavedItem({
      actorUserId: MARA,
      savedItemId: item.id,
      expectedVersion: item.version,
      reason: "We booked the same engineer again.",
    });

    expect(resolved).toMatchObject({
      status: "archived",
      resolutionReason: "We booked the same engineer again.",
      createdByUserId: BEN,
      lastActorUserId: MARA,
    });
  });

  it("keeps a departed member's attribution while ending their access", async () => {
    const item = await seedItem(harness, { actorUserId: BEN });
    await removeHouseholdMember(harness.store, {
      householdId: harness.householdId,
      userId: BEN,
    });

    // The record stays with the household, still crediting Ben...
    await expect(
      collaborationFor(harness).getHouseholdSavedItem({ actorUserId: ANA, savedItemId: item.id }),
    ).resolves.toMatchObject({ createdByUserId: BEN, ownership: "household_native" });
    // ...and Ben can no longer reach what he wrote for a household he left.
    await expect(
      collaborationFor(harness).getHouseholdSavedItem({ actorUserId: BEN, savedItemId: item.id }),
    ).rejects.toBeInstanceOf(HouseholdRecordUnavailableError);
  });

  it("refuses a former member's write with the same answer it gives a stranger", async () => {
    const item = await seedItem(harness);
    await removeHouseholdMember(harness.store, {
      householdId: harness.householdId,
      userId: MARA,
    });

    for (const actorUserId of [MARA, OUTSIDER]) {
      await expect(
        collaborationFor(harness).editHouseholdSavedItem({
          actorUserId,
          savedItemId: item.id,
          expectedVersion: item.version,
          edit: { title: "Mine now" },
        }),
      ).rejects.toBeInstanceOf(HouseholdRecordUnavailableError);
    }
  });
});

describe("dissolution", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await seedHousehold();
  });

  /**
   * The state `dissolve()` leaves behind: every membership ended, the workspace
   * row marked dissolved so its recovery window can run. The Saved Items are not
   * touched by it, and this is what proves that is the right call - they stay in
   * storage with their attribution for the recovery set, while nobody can reach
   * them (governance.ts, ADR 0213).
   */
  it("keeps household-native items in the recovery set while access ends for everyone", async () => {
    const item = await seedItem(harness, { actorUserId: MARA });
    for (const userId of [ANA, BEN, MARA]) {
      await removeHouseholdMember(harness.store, { householdId: harness.householdId, userId });
    }
    await harness.store.updateHouseholdWorkspace({
      householdId: harness.householdId,
      patch: { status: "dissolved", dissolvedAt: new Date("2026-08-01T00:00:00.000Z") },
    });

    await expect(harness.store.getSavedItemById({ savedItemId: item.id })).resolves.toMatchObject({
      ownership: "household_native",
      householdId: harness.householdId,
      createdByUserId: MARA,
    });
    for (const actorUserId of [ANA, BEN, MARA]) {
      await expect(
        collaborationFor(harness).getHouseholdSavedItem({ actorUserId, savedItemId: item.id }),
      ).rejects.toBeInstanceOf(HouseholdRecordUnavailableError);
    }
  });
});

/**
 * The other ownership form's end of life, which is the opposite of the
 * household-native one: a member-owned Saved Item shared into the household
 * leaves *with* its owner (`docs/phase-8/household-saved-items.md`).
 *
 * The revert itself is `revertMemberOwnedSavedItemsToPrivate`, one SQL statement
 * inside the same transaction as the membership change, so what is asserted here
 * is the pair of states either side of it - the state that made the revert
 * necessary, and the state it produces. Between them they say the whole rule:
 * without it the household reads on and the owner is locked out of their own
 * note, which is exactly backwards.
 */
describe("a member-owned Saved Item shared into the household", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await seedHousehold();
  });

  async function seedSharedByAna(scope: "household" | "shared") {
    return createSavedItemLifecycle(harness.store).createSavedItem({
      ownerUserId: ANA,
      kind: "note",
      title: "The gate code",
      scope,
      householdId: harness.householdId,
      ...(scope === "shared" ? { selectedUserIds: [BEN] } : {}),
    });
  }

  it.each([
    "household",
    "shared",
  ] as const)("strands its %s-scope owner and keeps serving the household until the revert runs", async (scope) => {
    const lifecycle = createSavedItemLifecycle(harness.store);
    const note = await seedSharedByAna(scope);

    await removeHouseholdMember(harness.store, {
      householdId: harness.householdId,
      userId: ANA,
    });

    // This is the window the revert closes, asserted so the need for it is
    // visible here and not only in governance. The audience rule wants a
    // current active membership before it ever consults ownership, so the
    // person who wrote the note is refused it - while Ben, who is still in the
    // household, reads on.
    await expect(
      lifecycle.getSavedItem({ callerUserId: ANA, savedItemId: note.id }),
    ).resolves.toBeNull();
    await expect(
      lifecycle.getSavedItem({ callerUserId: BEN, savedItemId: note.id }),
    ).resolves.toMatchObject({ id: note.id });
  });

  it.each([
    "household",
    "shared",
  ] as const)("comes home to its %s-scope owner once it is private again, and leaves the household", async (scope) => {
    const lifecycle = createSavedItemLifecycle(harness.store);
    const note = await seedSharedByAna(scope);

    await removeHouseholdMember(harness.store, {
      householdId: harness.householdId,
      userId: ANA,
    });
    // What the departure sweep writes: scope and household cleared, the shares
    // already dropped by the membership change that preceded it.
    await harness.store.updateSavedItem({
      ownerUserId: ANA,
      savedItemId: note.id,
      patch: { scope: "private", householdId: null },
    });
    await harness.store.deleteHouseholdRecordSharesForMember({
      householdId: harness.householdId,
      userId: ANA,
    });

    await expect(
      lifecycle.getSavedItem({ callerUserId: ANA, savedItemId: note.id }),
    ).resolves.toMatchObject({ id: note.id, scope: "private", householdId: null });
    for (const other of [BEN, MARA, OUTSIDER]) {
      await expect(
        lifecycle.getSavedItem({ callerUserId: other, savedItemId: note.id }),
      ).resolves.toBeNull();
    }
  });
});

describe("optimistic conflict reconciliation", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await seedHousehold();
  });

  it("hands the later writer the current value instead of overwriting the first", async () => {
    const item = await seedItem(harness);
    const collaboration = collaborationFor(harness);

    await collaboration.editHouseholdSavedItem({
      actorUserId: BEN,
      savedItemId: item.id,
      expectedVersion: item.version,
      edit: { title: "Ben's title" },
    });

    // Mara is still holding version 1, which she read before Ben saved.
    const conflict = await collaboration
      .editHouseholdSavedItem({
        actorUserId: MARA,
        savedItemId: item.id,
        expectedVersion: item.version,
        edit: { title: "Mara's title" },
      })
      .catch((error: unknown) => error);

    expect(conflict).toBeInstanceOf(SavedItemConflictError);
    expect((conflict as SavedItemConflictError).current).toMatchObject({
      title: "Ben's title",
      lastActorUserId: BEN,
      version: 2,
    });
    // Ben's save survives untouched: nothing here is last-write-wins or merged.
    await expect(
      collaboration.getHouseholdSavedItem({ actorUserId: ANA, savedItemId: item.id }),
    ).resolves.toMatchObject({ title: "Ben's title" });
  });

  /**
   * The overtaken-while-editing cases. Each of these used to surface as a flat
   * lifecycle refusal - "archived items are read-only", "cannot archive a Saved
   * Item that is archived" - which is true and tells the member nothing about
   * who overtook them or what to do next. They all resolve to one conflict now,
   * carrying the current status and the last actor.
   */
  it.each([
    [
      "promoted",
      async (harness: Harness, savedItemId: string) =>
        createHouseholdSavedItemCollaboration(harness.store, {
          createHouseholdNativeGeneralAction: async (created) => ({
            result: { id: created.id },
            affectedScopes: [],
          }),
        }).promoteHouseholdSavedItem({
          actorUserId: BEN,
          savedItemId,
          idempotencyKey: "promoted-mid-edit",
        }),
    ],
    [
      "archived",
      async (harness: Harness, savedItemId: string) =>
        collaborationFor(harness).archiveHouseholdSavedItem({ actorUserId: BEN, savedItemId }),
    ],
  ])("reconciles a member still editing when Ben has %s it", async (_case, overtake) => {
    const item = await seedItem(harness);
    await overtake(harness, item.id);

    const conflict = await collaborationFor(harness)
      .editHouseholdSavedItem({
        actorUserId: MARA,
        savedItemId: item.id,
        expectedVersion: item.version,
        edit: { title: "Mara's title" },
      })
      .catch((error: unknown) => error);

    expect(conflict).toBeInstanceOf(SavedItemConflictError);
    // Status and actor both travel with it, so the surface can say what happened
    // and who did it rather than only that the item is now read-only.
    expect((conflict as SavedItemConflictError).current).toMatchObject({
      status: "archived",
      lastActorUserId: BEN,
    });
  });

  it("still refuses an edit to an item the member knows is archived", async () => {
    // Not a conflict: nobody overtook them. `expectedVersion` matches, so the
    // ordinary lifecycle rule is the right and only answer.
    const item = await seedItem(harness);
    const archived = await collaborationFor(harness).archiveHouseholdSavedItem({
      actorUserId: MARA,
      savedItemId: item.id,
      expectedVersion: item.version,
    });

    await expect(
      collaborationFor(harness).editHouseholdSavedItem({
        actorUserId: MARA,
        savedItemId: item.id,
        expectedVersion: archived.version,
        edit: { title: "Mara's title" },
      }),
    ).rejects.toThrow("Archived Saved Items are read-only");
  });

  it("applies a deliberate replace once the member has seen the conflict", async () => {
    const item = await seedItem(harness);
    const collaboration = collaborationFor(harness);
    await collaboration.editHouseholdSavedItem({
      actorUserId: BEN,
      savedItemId: item.id,
      expectedVersion: item.version,
      edit: { title: "Ben's title" },
    });

    // No `expectedVersion`: Mara has been shown Ben's value and chose to replace it.
    const replaced = await collaboration.editHouseholdSavedItem({
      actorUserId: MARA,
      savedItemId: item.id,
      edit: { title: "Mara's title" },
    });

    expect(replaced).toMatchObject({ title: "Mara's title", lastActorUserId: MARA, version: 3 });
  });
});

describe("the two ownership forms stay apart", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await seedHousehold();
  });

  it("keeps the owner-scoped lifecycle away from a workspace-owned record", async () => {
    const item = await seedItem(harness);
    const lifecycle = createSavedItemLifecycle(harness.store);

    // Ana created it and is a Household Owner. Neither buys her the member-owned
    // path: that path is keyed by ownership, and nobody owns this.
    await expect(
      lifecycle.editSavedItem({
        actorUserId: ANA,
        savedItemId: item.id,
        edit: { title: "Mine" },
      }),
    ).rejects.toThrow("Saved Item not found.");
    await expect(
      lifecycle.deleteUniqueSavedItemSource({ actorUserId: ANA, savedItemId: item.id }),
    ).rejects.toThrow("Saved Item not found.");
  });

  it("refuses the household boundary a member-owned record", async () => {
    const lifecycle = createSavedItemLifecycle(harness.store);
    const mine = await lifecycle.createSavedItem({
      ownerUserId: ANA,
      kind: "note",
      title: "My own note",
      scope: "household",
      householdId: harness.householdId,
    });

    // Household-scoped, so Ben can see it - but seeing it is not authority over
    // it, and the household boundary must not be the way he gets that.
    await expect(
      collaborationFor(harness).editHouseholdSavedItem({
        actorUserId: BEN,
        savedItemId: mine.id,
        edit: { title: "Ours now" },
      }),
    ).rejects.toBeInstanceOf(HouseholdRecordUnavailableError);
    await expect(
      lifecycle.getSavedItem({ callerUserId: BEN, savedItemId: mine.id }),
    ).resolves.toMatchObject({ title: "My own note", ownerUserId: ANA });
  });

  it("leaves a shared item's lifecycle and evidence with its owner alone", async () => {
    const lifecycle = createSavedItemLifecycle(harness.store);
    const mine = await lifecycle.createSavedItem({
      ownerUserId: ANA,
      kind: "note",
      title: "My own note",
      scope: "shared",
      householdId: harness.householdId,
      selectedUserIds: [BEN],
    });

    // Ben was deliberately shown it, which is the whole of what he was given.
    await expect(
      lifecycle.getSavedItem({ callerUserId: BEN, savedItemId: mine.id }),
    ).resolves.toMatchObject({ id: mine.id });
    for (const attempt of [
      () =>
        lifecycle.editSavedItem({ actorUserId: BEN, savedItemId: mine.id, edit: { title: "x" } }),
      () => lifecycle.archiveSavedItem({ actorUserId: BEN, savedItemId: mine.id }),
      () => lifecycle.resolveSavedItem({ actorUserId: BEN, savedItemId: mine.id, reason: "done" }),
      () => lifecycle.deleteUniqueSavedItemSource({ actorUserId: BEN, savedItemId: mine.id }),
      () =>
        lifecycle.promoteSavedItemToGeneralAction({
          actorUserId: BEN,
          savedItemId: mine.id,
          authority: "explicit",
          idempotencyKey: "ben-tries",
        }),
    ]) {
      await expect(attempt()).rejects.toThrow("Saved Item not found.");
    }
  });
});

describe("promoting a household-native Saved Item", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await seedHousehold();
  });

  it("lands in a household-native Action and archives the item as resolved", async () => {
    const item = await seedItem(harness);
    const created: Array<{ householdId: string; createdByUserId: string; title: string }> = [];
    const collaboration = createHouseholdSavedItemCollaboration(harness.store, {
      createHouseholdNativeGeneralAction: async (input) => {
        created.push(input);
        return { result: { id: input.id }, affectedScopes: [] };
      },
    });

    const promotion = await collaboration.promoteHouseholdSavedItem({
      actorUserId: BEN,
      savedItemId: item.id,
      expectedVersion: item.version,
      idempotencyKey: "boiler-promotion",
    });

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      householdId: harness.householdId,
      createdByUserId: BEN,
      title: "Boiler service number",
      // Source grounding travels with the promotion rather than being re-derived.
      sourceRecordId: item.sourceRecordId,
    });
    expect(promotion.savedItem).toMatchObject({
      status: "archived",
      resolutionReason: "Promoted to a household Action.",
      ownership: "household_native",
      ownerUserId: null,
    });
  });

  it("resumes rather than creating a second Action when retried", async () => {
    const item = await seedItem(harness);
    let calls = 0;
    const collaboration = createHouseholdSavedItemCollaboration(harness.store, {
      createHouseholdNativeGeneralAction: async (input) => {
        calls += 1;
        return { result: { id: input.id }, affectedScopes: [] };
      },
    });
    const promote = () =>
      collaboration.promoteHouseholdSavedItem({
        actorUserId: BEN,
        savedItemId: item.id,
        idempotencyKey: "boiler-promotion",
      });

    const first = await promote();
    const second = await promote();

    expect(calls).toBe(1);
    expect(second.savedItem.resolvedAt).toEqual(first.savedItem.resolvedAt);
    await expect(
      harness.store.listSavedItemOutcomes({ savedItemId: item.id }),
    ).resolves.toHaveLength(1);
  });

  it("declines the destination rather than inventing a member-owned one", async () => {
    const item = await seedItem(harness);

    // This collaboration is composed without a household-native Action writer.
    // Production supplies one, but refusing is the direction the boundary falls
    // back to on its own: the alternative is quietly handing the household's
    // record to whoever pressed promote.
    await expect(
      collaborationFor(harness).promoteHouseholdSavedItem({
        actorUserId: BEN,
        savedItemId: item.id,
        idempotencyKey: "boiler-promotion",
      }),
    ).rejects.toThrow("Household Actions aren't available yet");
    await expect(
      collaborationFor(harness).getHouseholdSavedItem({ actorUserId: BEN, savedItemId: item.id }),
    ).resolves.toMatchObject({ status: "active" });
  });
});

describe("member-owned promotion into a household Action", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await seedHousehold();
  });

  it("creates a workspace-owned Action without transferring the Saved Item", async () => {
    const created: Array<{ householdId: string; createdByUserId: string }> = [];
    const lifecycle = createSavedItemLifecycle(harness.store, {
      createHouseholdNativeGeneralAction: async (input) => {
        created.push(input);
        return { result: { id: input.id }, affectedScopes: [] };
      },
    });
    const mine = await lifecycle.createSavedItem({
      ownerUserId: ANA,
      kind: "note",
      title: "Book the boiler service",
      scope: "household",
      householdId: harness.householdId,
    });

    const promotion = await lifecycle.promoteSavedItemToGeneralAction({
      actorUserId: ANA,
      savedItemId: mine.id,
      authority: "explicit",
      idempotencyKey: "make-household-action",
      destination: "household_native",
    });

    expect(created[0]).toMatchObject({
      householdId: harness.householdId,
      createdByUserId: ANA,
    });
    // The Saved Item itself is archived as resolved. It never becomes
    // household-native: what moved to the household is the new Action.
    expect(promotion.savedItem).toMatchObject({
      ownership: "member_owned",
      ownerUserId: ANA,
      status: "archived",
      resolutionReason: "Promoted to a household Action.",
    });
  });

  it("needs a household before it can hand one an Action", async () => {
    const lifecycle = createSavedItemLifecycle(harness.store, {
      createHouseholdNativeGeneralAction: async (input) => ({
        result: { id: input.id },
        affectedScopes: [],
      }),
    });
    const mine = await lifecycle.createSavedItem({
      ownerUserId: ANA,
      kind: "note",
      title: "Book the boiler service",
    });

    await expect(
      lifecycle.promoteSavedItemToGeneralAction({
        actorUserId: ANA,
        savedItemId: mine.id,
        authority: "explicit",
        idempotencyKey: "make-household-action",
        destination: "household_native",
      }),
    ).rejects.toThrow("Share this with your household first");
  });
});
