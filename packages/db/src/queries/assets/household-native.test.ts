import { describe, expect, it } from "vitest";
import { removeHouseholdMember, seedHouseholdWithMembers } from "../households/household-fixtures";
import { createAssetAuthority } from "./household-authority";
import { createInMemoryAssetReviewLifecycleStore } from "./in-memory-review-store";
import { createAssetLifecycle } from "./lifecycle";
import { createAssetReview } from "./review";

/**
 * The Phase Eight collaboration contract for household Assets and Asset
 * Memories, exercised across a real multi-member household rather than one
 * actor.
 *
 * Two members and an outsider, because every rule here is about the difference
 * between them: what a member-owned Asset keeps from its owner, what a
 * household-native one hands to everybody, and what neither gives away. It
 * deliberately mirrors `general-actions/household-native.test.ts` case for case
 * — two household-native families that disagree about departure or symmetry
 * would be a fork of ADR 0214, not two features.
 */
const OWNER = "user-owner";
const MEMBER = "user-member";
const OUTSIDER = "user-outsider";

/** The single sentence every refusal produces (ADR 0219). */
const UNAVAILABLE = /no longer available/;

/** A real JPEG header, so the capture path's signature check accepts it. */
const RECEIPT_FILE = {
  fileName: "plate.jpg",
  mimeType: "image/jpeg",
  sizeBytes: 6,
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]),
};

async function household() {
  const store = createInMemoryAssetReviewLifecycleStore();
  const lifecycle = createAssetLifecycle(store);
  const review = createAssetReview(store);
  const workspace = await seedHouseholdWithMembers(store, {
    ownerUserId: OWNER,
    name: "Home",
    members: [
      [OWNER, "owner"],
      [MEMBER, "member"],
    ],
  });

  /** The household's own thing: workspace-owned, everyone's to maintain. */
  const seedHouseholdNative = (overrides: { createdBy?: string; name?: string } = {}) =>
    lifecycle.createAsset({
      ownerUserId: overrides.createdBy ?? OWNER,
      name: overrides.name ?? "Kitchen refrigerator",
      kind: "appliance",
      ownership: "household_native",
      householdId: workspace.id,
    });

  /** "My car, which you may refer to": owned by OWNER, visible household-wide. */
  const seedMemberOwnedShared = (overrides: { owner?: string; name?: string } = {}) =>
    lifecycle.createAsset({
      ownerUserId: overrides.owner ?? OWNER,
      name: overrides.name ?? "My estate car",
      kind: "vehicle",
      scope: "household",
      householdId: workspace.id,
    });

  return { store, lifecycle, review, workspace, seedHouseholdNative, seedMemberOwnedShared };
}

describe("creating a household-native Asset", () => {
  it("belongs to the workspace, is visible household-wide, and keeps its creator as provenance only", async () => {
    const { lifecycle, workspace, seedHouseholdNative } = await household();

    const fridge = await seedHouseholdNative({ createdBy: MEMBER });

    expect(fridge).toMatchObject({
      ownership: "household_native",
      scope: "household",
      householdId: workspace.id,
      createdByUserId: MEMBER,
      status: "active",
      revision: 0,
    });
    // Visible to the other member without any share row, by definition.
    await expect(
      lifecycle.getAsset({ callerUserId: OWNER, assetId: fridge.id }),
    ).resolves.toMatchObject({ id: fridge.id });
  });

  it("stays out of reach of someone who is not in the household", async () => {
    const { lifecycle, seedHouseholdNative } = await household();
    const fridge = await seedHouseholdNative();

    await expect(
      lifecycle.getAsset({ callerUserId: OUTSIDER, assetId: fridge.id }),
    ).resolves.toBeNull();
    await expect(
      lifecycle.editAsset({
        actorUserId: OUTSIDER,
        assetId: fridge.id,
        edit: { name: "Mine now" },
      }),
    ).rejects.toThrow(UNAVAILABLE);
  });

  it("cannot be handed to a household the creator is not in", async () => {
    const { lifecycle, workspace } = await household();

    await expect(
      lifecycle.createAsset({
        ownerUserId: OUTSIDER,
        name: "Not yours",
        kind: "item",
        ownership: "household_native",
        householdId: workspace.id,
      }),
    ).rejects.toThrow();
  });
});

describe("symmetric authority over the household's own Asset", () => {
  it("lets any active member rename, re-kind, archive, and restore it", async () => {
    const { lifecycle, seedHouseholdNative } = await household();
    const fridge = await seedHouseholdNative({ createdBy: OWNER });

    const edited = await lifecycle.editAsset({
      actorUserId: MEMBER,
      assetId: fridge.id,
      edit: { name: "Kitchen fridge" },
    });
    expect(edited).toMatchObject({ name: "Kitchen fridge", lastActorUserId: MEMBER });

    const archived = await lifecycle.archiveAsset({ actorUserId: MEMBER, assetId: fridge.id });
    expect(archived).toMatchObject({ status: "archived", lastActorUserId: MEMBER });

    const restored = await lifecycle.restoreAsset({ actorUserId: OWNER, assetId: fridge.id });
    expect(restored).toMatchObject({ status: "active", lastActorUserId: OWNER });
  });

  it("gives the Household Owner and the creator no extra content authority", async () => {
    const { lifecycle, seedHouseholdNative } = await household();
    // Created by the plain member; the Household Owner has exactly the same
    // standing over it as they do, and no more (ADR 0214).
    const fridge = await seedHouseholdNative({ createdBy: MEMBER });

    await expect(
      lifecycle.editAsset({ actorUserId: OWNER, assetId: fridge.id, edit: { kind: "item" } }),
    ).resolves.toMatchObject({ kind: "item" });
  });

  it("is archived rather than deleted, by anybody", async () => {
    const { lifecycle, seedHouseholdNative } = await household();
    const fridge = await seedHouseholdNative({ createdBy: OWNER });

    // A curated, showable sentence: it is about the kind of record, not about
    // this caller, and it names the thing to do instead.
    for (const actor of [OWNER, MEMBER]) {
      await expect(
        lifecycle.hardDeleteAsset({ actorUserId: actor, assetId: fridge.id }),
      ).rejects.toThrow(/archived, not deleted/);
    }
    await expect(
      lifecycle.getAsset({ callerUserId: MEMBER, assetId: fridge.id }),
    ).resolves.toMatchObject({ id: fridge.id });
  });

  it("has no audience to change, because it is already everyone's", async () => {
    const { store, seedHouseholdNative } = await household();
    const fridge = await seedHouseholdNative();

    await expect(
      createAssetAuthority(store).requireAssetAuthority({
        actorUserId: OWNER,
        asset: fridge,
        operation: "audience",
      }),
    ).rejects.toThrow(/already there for everyone/);
  });
});

describe("what a member-owned Asset keeps from its owner", () => {
  it("refuses every content change to a member who can merely see it", async () => {
    const { lifecycle, seedMemberOwnedShared } = await household();
    const car = await seedMemberOwnedShared();

    await expect(
      lifecycle.getAsset({ callerUserId: MEMBER, assetId: car.id }),
    ).resolves.toMatchObject({ id: car.id });

    for (const attempt of [
      () => lifecycle.editAsset({ actorUserId: MEMBER, assetId: car.id, edit: { name: "Ours" } }),
      () => lifecycle.archiveAsset({ actorUserId: MEMBER, assetId: car.id }),
      () => lifecycle.hardDeleteAsset({ actorUserId: MEMBER, assetId: car.id }),
    ]) {
      await expect(attempt()).rejects.toThrow(UNAVAILABLE);
    }
  });

  it("still lets the owner do all three", async () => {
    const { lifecycle, seedMemberOwnedShared } = await household();
    const car = await seedMemberOwnedShared();

    await expect(
      lifecycle.editAsset({ actorUserId: OWNER, assetId: car.id, edit: { name: "The estate" } }),
    ).resolves.toMatchObject({ name: "The estate" });
    await lifecycle.archiveAsset({ actorUserId: OWNER, assetId: car.id });
    await lifecycle.restoreAsset({ actorUserId: OWNER, assetId: car.id });
    await expect(
      lifecycle.hardDeleteAsset({ actorUserId: OWNER, assetId: car.id }),
    ).resolves.toBeUndefined();
  });
});

describe("details under an Asset", () => {
  it("lets a member keep their own private note on the household's Asset", async () => {
    const { review, seedHouseholdNative } = await household();
    const fridge = await seedHouseholdNative();

    const note = await review.createActiveAssetMemory({
      ownerUserId: MEMBER,
      assetId: fridge.id,
      label: "Reminder to self",
      notes: "Ask about the extended warranty.",
    });
    expect(note).toMatchObject({ ownership: "member_owned", scope: "private" });

    // ADR 0179 on the read side: the parent being everyone's says nothing about
    // the child, and each child answers for itself on every list.
    await expect(
      review.listAssetMemories({ callerUserId: OWNER, assetId: fridge.id }),
    ).resolves.toEqual([]);
    await expect(
      review.listAssetMemories({ callerUserId: MEMBER, assetId: fridge.id }),
    ).resolves.toMatchObject([{ id: note.id }]);
  });

  it("makes a household detail everyone's, whatever scope was asked for", async () => {
    const { review, seedHouseholdNative } = await household();
    const fridge = await seedHouseholdNative();

    const filter = await review.createActiveAssetMemory({
      ownerUserId: MEMBER,
      assetId: fridge.id,
      label: "Filter size",
      value: { type: "text", text: "EDR3RXD1" },
      ownership: "household_native",
      // Asked for private; a workspace-owned detail has no narrower audience.
      scope: "private",
    });
    expect(filter).toMatchObject({ ownership: "household_native", scope: "household" });

    await expect(
      review.listAssetMemories({ callerUserId: OWNER, assetId: fridge.id }),
    ).resolves.toMatchObject([{ id: filter.id }]);
  });

  it("refuses a workspace-owned detail on a member's own Asset", async () => {
    const { review, seedMemberOwnedShared } = await household();
    const car = await seedMemberOwnedShared();

    // Otherwise the owner's departure would take the household's record with it.
    await expect(
      review.createActiveAssetMemory({
        ownerUserId: MEMBER,
        assetId: car.id,
        label: "Service interval",
        notes: "Every 12 months.",
        ownership: "household_native",
      }),
    ).rejects.toThrow(/household detail belongs on a household asset/);
  });

  it("lets any active member correct and set aside the household's own detail", async () => {
    const { review, seedHouseholdNative } = await household();
    const fridge = await seedHouseholdNative();
    const filter = await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: fridge.id,
      label: "Filter size",
      value: { type: "text", text: "WRONG" },
      ownership: "household_native",
    });

    const corrected = await review.editAssetMemory({
      actorUserId: MEMBER,
      memoryId: filter.id,
      edit: { value: { type: "text", text: "EDR3RXD1" } },
    });
    expect(corrected).toMatchObject({
      value: { type: "text", text: "EDR3RXD1" },
      lastActorUserId: MEMBER,
    });

    await review.setAsideAssetMemory({ actorUserId: MEMBER, memoryId: filter.id });
    await expect(
      review.listAssetMemories({ callerUserId: OWNER, assetId: fridge.id }),
    ).resolves.toEqual([]);
  });

  it("brings a set-aside detail back, which is what the surface's undo spends", async () => {
    const { review, seedHouseholdNative } = await household();
    const fridge = await seedHouseholdNative();
    const filter = await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: fridge.id,
      label: "Filter size",
      value: { type: "text", text: "EDR3RXD1" },
      ownership: "household_native",
    });

    await review.setAsideAssetMemory({ actorUserId: MEMBER, memoryId: filter.id });
    await expect(
      review.listAssetMemories({ callerUserId: OWNER, assetId: fridge.id }),
    ).resolves.toEqual([]);

    // The record never left, so the undo is a status change on the same row —
    // and any active member may spend it, like the set-aside itself.
    await expect(
      review.restoreAssetMemory({ actorUserId: OWNER, memoryId: filter.id }),
    ).resolves.toMatchObject({ id: filter.id, status: "active" });
    await expect(
      review.listAssetMemories({ callerUserId: MEMBER, assetId: fridge.id }),
    ).resolves.toMatchObject([{ id: filter.id }]);
  });

  it("settles rather than refuses when two members set the same detail aside", async () => {
    const { review, seedHouseholdNative } = await household();
    const fridge = await seedHouseholdNative();
    const filter = await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: fridge.id,
      label: "Filter size",
      value: { type: "text", text: "EDR3RXD1" },
      ownership: "household_native",
    });

    await review.setAsideAssetMemory({ actorUserId: OWNER, memoryId: filter.id });

    // Arriving second is not a failure: the state the member wanted is the state
    // the record is in, and an undo that lands twice must not error either.
    await expect(
      review.setAsideAssetMemory({ actorUserId: MEMBER, memoryId: filter.id }),
    ).resolves.toMatchObject({ status: "dismissed" });
    await review.restoreAssetMemory({ actorUserId: OWNER, memoryId: filter.id });
    await expect(
      review.restoreAssetMemory({ actorUserId: MEMBER, memoryId: filter.id }),
    ).resolves.toMatchObject({ status: "active" });
  });

  it("tells a member plainly when the detail they were correcting was set aside", async () => {
    const { review, seedHouseholdNative } = await household();
    const fridge = await seedHouseholdNative();
    const filter = await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: fridge.id,
      label: "Filter size",
      value: { type: "text", text: "EDR3RXD1" },
      ownership: "household_native",
    });
    await review.setAsideAssetMemory({ actorUserId: OWNER, memoryId: filter.id });

    // A curated, showable sentence rather than the opaque refusal: someone else
    // setting it aside mid-edit is not a protected fact, and the member needs to
    // know what to do next.
    await expect(
      review.editAssetMemory({
        actorUserId: MEMBER,
        memoryId: filter.id,
        edit: { value: { type: "text", text: "Something else" } },
      }),
    ).rejects.toThrow(/set aside while you were editing/);
  });

  it("keeps one member's own detail out of another member's hands", async () => {
    const { review, seedHouseholdNative } = await household();
    const fridge = await seedHouseholdNative();
    const mine = await review.createActiveAssetMemory({
      ownerUserId: MEMBER,
      assetId: fridge.id,
      label: "My note",
      notes: "Mine.",
      scope: "household",
    });

    await expect(
      review.editAssetMemory({
        actorUserId: OWNER,
        memoryId: mine.id,
        edit: { notes: "Not any more." },
      }),
    ).rejects.toThrow(UNAVAILABLE);
    await expect(
      review.setAsideAssetMemory({ actorUserId: OWNER, memoryId: mine.id }),
    ).rejects.toThrow(UNAVAILABLE);
  });

  it("shares evidence independently of its Asset, in both directions", async () => {
    const { review, seedHouseholdNative } = await household();
    const fridge = await seedHouseholdNative();

    const privateReceipt = await review.addAssetEvidence({
      ownerUserId: OWNER,
      assetId: fridge.id,
      kind: "receipt",
      label: "What I actually paid",
      capturedText: "$1,240",
      scope: "private",
    });
    const sharedManual = await review.addAssetEvidence({
      ownerUserId: OWNER,
      assetId: fridge.id,
      kind: "manual",
      label: "Install guide",
      url: "https://example.com/manual",
      ownership: "household_native",
    });

    // A household Asset holding a private receipt is the case ADR 0179 exists
    // for: the member sees the manual and never learns the receipt is there.
    await expect(
      review.listAssetEvidence({ callerUserId: MEMBER, assetId: fridge.id }),
    ).resolves.toMatchObject([{ id: sharedManual.id }]);
    await expect(
      review.listAssetEvidence({ callerUserId: OWNER, assetId: fridge.id }),
    ).resolves.toHaveLength(2);

    await expect(
      review.removeAssetEvidence({ actorUserId: MEMBER, evidenceId: privateReceipt.id }),
    ).rejects.toThrow(UNAVAILABLE);
    // The household's own evidence is the workspace's, so any active member may
    // remove it — the same symmetry the Asset itself has.
    await expect(
      review.removeAssetEvidence({ actorUserId: MEMBER, evidenceId: sharedManual.id }),
    ).resolves.toMatchObject({ id: sharedManual.id });
  });

  it("refuses a detail more visible than the Asset it hangs off", async () => {
    const { review, lifecycle } = await household();
    const private_ = await lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "My watch",
      kind: "item",
    });

    await expect(
      review.createActiveAssetMemory({
        ownerUserId: OWNER,
        assetId: private_.id,
        label: "Serial",
        notes: "12345",
        scope: "household",
      }),
    ).rejects.toThrow(/can't be more visible than its asset/);
  });
});

describe("two members writing at once", () => {
  it("keeps the second member's draft instead of overwriting the first's edit", async () => {
    const { lifecycle, seedHouseholdNative } = await household();
    const fridge = await seedHouseholdNative();

    await lifecycle.editAsset({
      actorUserId: OWNER,
      assetId: fridge.id,
      edit: { name: "Kitchen fridge" },
      expectedRevision: fridge.revision,
    });

    // MEMBER's form still holds the revision they rendered from.
    await expect(
      lifecycle.editAsset({
        actorUserId: MEMBER,
        assetId: fridge.id,
        edit: { name: "The big fridge" },
        expectedRevision: fridge.revision,
      }),
    ).rejects.toMatchObject({
      name: "AssetConflictError",
      conflict: { currentValue: "Kitchen fridge", actorUserId: OWNER, revision: 1 },
    });

    // The escape hatch: having seen the current value, they may replace it.
    await expect(
      lifecycle.editAsset({
        actorUserId: MEMBER,
        assetId: fridge.id,
        edit: { name: "The big fridge" },
      }),
    ).resolves.toMatchObject({ name: "The big fridge" });
  });

  it("fences a jointly-maintained detail the same way", async () => {
    const { review, seedHouseholdNative } = await household();
    const fridge = await seedHouseholdNative();
    const filter = await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: fridge.id,
      label: "Filter size",
      value: { type: "text", text: "A" },
      ownership: "household_native",
    });

    await review.editAssetMemory({
      actorUserId: OWNER,
      memoryId: filter.id,
      edit: { value: { type: "text", text: "B" } },
    });
    await expect(
      review.editAssetMemory({
        actorUserId: MEMBER,
        memoryId: filter.id,
        edit: { value: { type: "text", text: "C" } },
        expectedRevision: filter.revision,
      }),
    ).rejects.toMatchObject({ name: "AssetConflictError" });
  });
});

describe("departure", () => {
  it("ends access to the household's Assets immediately, keeping the departed member's attribution", async () => {
    const { store, lifecycle, review, workspace, seedHouseholdNative } = await household();
    const fridge = await seedHouseholdNative({ createdBy: MEMBER });
    await review.createActiveAssetMemory({
      ownerUserId: MEMBER,
      assetId: fridge.id,
      label: "Filter size",
      value: { type: "text", text: "EDR3RXD1" },
      ownership: "household_native",
    });

    await removeHouseholdMember(store, { householdId: workspace.id, userId: MEMBER });

    // The creator loses it like anybody else: `ownerUserId` was a storage key,
    // never an access path (ADR 0214).
    await expect(
      lifecycle.getAsset({ callerUserId: MEMBER, assetId: fridge.id }),
    ).resolves.toBeNull();
    await expect(
      lifecycle.editAsset({ actorUserId: MEMBER, assetId: fridge.id, edit: { name: "Mine" } }),
    ).rejects.toThrow(UNAVAILABLE);
    await expect(
      review.listAssetMemories({ callerUserId: MEMBER, assetId: fridge.id }),
    ).resolves.toEqual([]);

    // The workspace keeps the record, the detail, and who wrote them.
    const kept = await lifecycle.getAsset({ callerUserId: OWNER, assetId: fridge.id });
    expect(kept).toMatchObject({ id: fridge.id, createdByUserId: MEMBER });
    await expect(
      review.listAssetMemories({ callerUserId: OWNER, assetId: fridge.id }),
    ).resolves.toMatchObject([{ createdByUserId: MEMBER }]);
  });

  it("leaves a departed member's own shared Asset unreachable until governance brings it home", async () => {
    const { store, lifecycle, workspace, seedMemberOwnedShared } = await household();
    const car = await seedMemberOwnedShared({ owner: MEMBER, name: "Their car" });

    await removeHouseholdMember(store, { householdId: workspace.id, userId: MEMBER });

    // This is the state the departure sweep exists to end, asserted here so the
    // need for it is visible in the seam and not only in governance. The
    // owner-keyed read still finds their own row — that path never consulted a
    // household — but every *authority* question resolves through the proof,
    // which needs a current active membership at `household` scope. So a
    // departed member can still see what they wrote and can no longer change
    // it, while the household reads on. `revertMemberOwnedAssetsToPrivate` runs
    // inside the same transaction as the membership change precisely so this
    // window is never observable in production: what someone wrote is still
    // theirs, and it goes home with them.
    await expect(
      lifecycle.getAsset({ callerUserId: MEMBER, assetId: car.id }),
    ).resolves.toMatchObject({ id: car.id });
    await expect(
      lifecycle.editAsset({ actorUserId: MEMBER, assetId: car.id, edit: { name: "Still mine" } }),
    ).rejects.toThrow(UNAVAILABLE);
  });

  it("refuses every detail path to a departed member with the one opaque sentence", async () => {
    const { store, review, workspace, seedHouseholdNative } = await household();
    const fridge = await seedHouseholdNative({ createdBy: OWNER });
    const shared = await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: fridge.id,
      label: "Filter size",
      value: { type: "text", text: "EDR3RXD1" },
      ownership: "household_native",
    });
    const mine = await review.createActiveAssetMemory({
      ownerUserId: MEMBER,
      assetId: fridge.id,
      label: "Where the receipt is",
      notes: "Top drawer.",
      scope: "household",
    });

    await removeHouseholdMember(store, { householdId: workspace.id, userId: MEMBER });

    // Both ownership forms, all three write paths: a member who left mid-view
    // gets the same sentence whether the detail was the household's or their own
    // shared one — the difference between them is exactly the protected fact.
    for (const memoryId of [shared.id, mine.id]) {
      await expect(
        review.editAssetMemory({
          actorUserId: MEMBER,
          memoryId,
          edit: { notes: "Still mine." },
        }),
      ).rejects.toThrow(UNAVAILABLE);
      await expect(review.setAsideAssetMemory({ actorUserId: MEMBER, memoryId })).rejects.toThrow(
        UNAVAILABLE,
      );
      await expect(review.restoreAssetMemory({ actorUserId: MEMBER, memoryId })).rejects.toThrow(
        UNAVAILABLE,
      );
    }
  });

  it("stops serving the household's evidence bytes to the member who captured them", async () => {
    const { store, review, workspace, seedHouseholdNative } = await household();
    const fridge = await seedHouseholdNative({ createdBy: OWNER });
    const plate = await review.addAssetEvidence({
      ownerUserId: MEMBER,
      assetId: fridge.id,
      kind: "photo",
      label: "Serial plate",
      file: RECEIPT_FILE,
      ownership: "household_native",
    });

    await expect(
      review.getAssetEvidenceFile({ callerUserId: MEMBER, evidenceId: plate.id }),
    ).resolves.toMatchObject({ fileName: "plate.jpg" });

    await removeHouseholdMember(store, { householdId: workspace.id, userId: MEMBER });

    // The bytes route is the deep link ADR 0219 names: the url outlives the page
    // that produced it, and household-native evidence keeps its capturer's id in
    // `ownerUserId`. Honouring that as an access path would leave whoever
    // photographed the serial plate fetching it forever.
    await expect(
      review.getAssetEvidenceFile({ callerUserId: MEMBER, evidenceId: plate.id }),
    ).resolves.toBeNull();
    await expect(
      review.getAssetEvidenceFile({ callerUserId: OWNER, evidenceId: plate.id }),
    ).resolves.toMatchObject({ fileName: "plate.jpg" });
  });

  it("takes the same care of a departed member's own detail as of their Asset", async () => {
    const { store, review, workspace, seedHouseholdNative } = await household();
    const fridge = await seedHouseholdNative({ createdBy: OWNER });
    const theirs = await review.createActiveAssetMemory({
      ownerUserId: MEMBER,
      assetId: fridge.id,
      label: "Where the receipt is",
      notes: "Top drawer.",
      scope: "household",
    });

    await expect(
      review.listAssetMemories({ callerUserId: OWNER, assetId: fridge.id }),
    ).resolves.toMatchObject([{ id: theirs.id }]);

    await removeHouseholdMember(store, { householdId: workspace.id, userId: MEMBER });

    // Same window, one level down, and the reason the sweep reverts children as
    // well as parents: their own detail becomes unreachable to them while the
    // household can still read it. The Asset itself is the workspace's and
    // rightly stays — the detail on it was this member's sharing, and their
    // sharing ends with their access (ADR 0179, ADR 0214).
    await expect(
      review.listAssetMemories({ callerUserId: MEMBER, assetId: fridge.id }),
    ).resolves.toEqual([]);
    await expect(
      review.editAssetMemory({
        actorUserId: MEMBER,
        memoryId: theirs.id,
        edit: { notes: "Second drawer." },
      }),
    ).rejects.toThrow(UNAVAILABLE);
  });
});
