import { AssetValidationError } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createAuditKindsReader, seedOwnerMemberHousehold } from "./asset-test-fixtures";
import { createInMemoryAssetReviewLifecycleStore } from "./in-memory-review-store";
import { createAssetLifecycle } from "./lifecycle";
import { createAssetReview } from "./review";

const OWNER = "user-1";
const MEMBER = "user-member";
const OUTSIDER = "user-outsider";

function setup() {
  const store = createInMemoryAssetReviewLifecycleStore();
  const review = createAssetReview(store);
  const lifecycle = createAssetLifecycle(store);

  function seedSource(overrides: Partial<Parameters<typeof store.createSourceRecord>[0]> = {}) {
    return store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "New fridge filter is EDR3RXD1, bought Mar 14 for $42.99.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity: "normal",
      scope: "private",
      importance: 3,
      metadataJson: {},
      ...overrides,
    });
  }

  async function seedSuggestedAsset(
    overrides: Partial<Parameters<typeof review.suggestAsset>[0]> = {},
  ) {
    const source = await seedSource();
    return review.suggestAsset({
      ownerUserId: OWNER,
      name: "Fridge filter",
      kind: "appliance",
      sourceRecordId: source.id,
      memories: [
        { label: "Filter model", value: { type: "text", text: "EDR3RXD1" } },
        { label: "Purchase date", value: { type: "date", date: "2026-03-14" } },
      ],
      ...overrides,
    });
  }

  const seedHousehold = () => seedOwnerMemberHousehold(store, OWNER, MEMBER);
  const auditKinds = createAuditKindsReader(lifecycle, OWNER);

  /** An existing durable asset plus a memory-only review group anchored to it. */
  async function seedExistingAssetGroup() {
    const asset = await lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Refrigerator water filter",
      kind: "appliance",
    });
    const source = await seedSource();
    const result = await review.suggestAssetMemories({
      ownerUserId: OWNER,
      assetId: asset.id,
      sourceRecordId: source.id,
      memories: [{ label: "Warranty ends", value: { type: "date", date: "2027-03-14" } }],
    });
    return { asset, result };
  }

  /** Asserts a dismissal resolved the group: no pending members, all rows set aside. */
  async function expectAllMemoriesDismissed(
    dismissed: {
      asset: { status: string };
      memories: unknown[];
    },
    expectedAssetStatus: string,
  ) {
    expect(dismissed.asset.status).toBe(expectedAssetStatus);
    expect(dismissed.memories).toEqual([]);
    const memories = await store.listAssetMemoriesForOwner({ ownerUserId: OWNER });
    expect(memories.every((memory) => memory.status === "dismissed")).toBe(true);
  }

  return {
    store,
    review,
    lifecycle,
    seedSource,
    seedSuggestedAsset,
    seedHousehold,
    auditKinds,
    seedExistingAssetGroup,
    expectAllMemoriesDismissed,
  };
}

describe("suggest an asset with memories", () => {
  it("persists a grounded review group of suggested rows, off every durable surface", async () => {
    const { lifecycle, seedSuggestedAsset } = setup();
    const result = await seedSuggestedAsset();

    expect(result.asset.status).toBe("suggested");
    expect(result.assetPending).toBe(true);
    expect(result.memories).toHaveLength(2);
    expect(result.memories.every((memory) => memory.status === "suggested")).toBe(true);
    expect(result.memories.every((memory) => memory.reviewGroupId === result.group.id)).toBe(true);
    expect(result.memories.every((memory) => memory.assetId === result.asset.id)).toBe(true);
    expect(result.sourceRecord?.id).toBe(result.group.sourceRecordId);
    expect(result.component).toEqual({
      type: "asset_review_group",
      groupId: result.group.id,
      assetId: result.asset.id,
      sourceRecordId: result.group.sourceRecordId,
    });

    // Not a durable record anywhere: the owner's Assets surface and profile reads
    // exclude proposals until they are accepted.
    await expect(lifecycle.listAssets({ callerUserId: OWNER })).resolves.toEqual([]);
    await expect(
      lifecycle.getAsset({ callerUserId: OWNER, assetId: result.asset.id }),
    ).resolves.toBeNull();
  });

  it("requires source grounding", async () => {
    const { review } = setup();
    await expect(
      review.suggestAsset({
        ownerUserId: OWNER,
        name: "Fridge filter",
        kind: "appliance",
        sourceRecordId: "missing-source",
      }),
    ).rejects.toThrow(/grounded/i);
  });

  it("keeps restricted context out of proactive suggestions unless asked directly", async () => {
    const { review, seedSource } = setup();
    const restricted = await seedSource({ sensitivity: "restricted" });

    await expect(
      review.suggestAsset({
        ownerUserId: OWNER,
        name: "Therapy subscription",
        kind: "subscription",
        sourceRecordId: restricted.id,
      }),
    ).rejects.toThrow(/restricted/i);

    const direct = await review.suggestAsset({
      ownerUserId: OWNER,
      name: "Therapy subscription",
      kind: "subscription",
      sourceRecordId: restricted.id,
      directlyRequested: true,
    });
    expect(direct.assetPending).toBe(true);
  });

  it("defaults suggested memories to the proposal's scope and enforces the ceiling", async () => {
    const { review, seedSuggestedAsset, seedHousehold, seedSource } = setup();
    const household = await seedHousehold();

    const result = await seedSuggestedAsset({
      scope: "household",
      householdId: household.id,
    });
    expect(result.asset.scope).toBe("household");
    expect(result.memories.every((memory) => memory.scope === "household")).toBe(true);

    // A household-visible detail under a private proposal would widen the
    // audience beyond the asset — rejected fail-closed.
    const source = await seedSource();
    await expect(
      review.suggestAsset({
        ownerUserId: OWNER,
        name: "Bike pump",
        kind: "item",
        sourceRecordId: source.id,
        memories: [{ label: "Location", notes: "Garage shelf", scope: "household" }],
      }),
    ).rejects.toThrow(AssetValidationError);
  });

  it("records the suggested trail in the internal audit", async () => {
    const { seedSuggestedAsset, auditKinds } = setup();
    const result = await seedSuggestedAsset();
    await expect(auditKinds(result.asset.id)).resolves.toEqual([
      "suggested",
      "memory_suggested",
      "memory_suggested",
    ]);
  });

  it("surfaces deterministic duplicate candidates from the assets the owner can see", async () => {
    const { lifecycle, seedSuggestedAsset } = setup();
    const existing = await lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Refrigerator water filter",
      kind: "appliance",
    });
    await lifecycle.createAsset({ ownerUserId: OWNER, name: "Toyota Corolla", kind: "vehicle" });

    const result = await seedSuggestedAsset({ name: "fridge filter" });
    expect(result.duplicateCandidates.map((asset) => asset.id)).toEqual([existing.id]);
  });
});

describe("suggest memories for an existing asset", () => {
  it("anchors the group to the durable asset with no duplicate prompt", async () => {
    const { lifecycle, seedExistingAssetGroup } = setup();
    const { asset, result } = await seedExistingAssetGroup();

    expect(result.asset.id).toBe(asset.id);
    expect(result.assetPending).toBe(false);
    expect(result.duplicateCandidates).toEqual([]);
    expect(result.memories).toHaveLength(1);
    // The durable asset itself is untouched — still active on the surface.
    const listed = await lifecycle.listAssets({ callerUserId: OWNER });
    expect(listed.map((a) => a.id)).toEqual([asset.id]);
  });

  it("rejects an archived anchor and an asset the suggester cannot see", async () => {
    const { review, lifecycle, seedSource } = setup();
    const archived = await lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Old dryer",
      kind: "appliance",
    });
    await lifecycle.archiveAsset({ actorUserId: OWNER, assetId: archived.id });
    const source = await seedSource();

    await expect(
      review.suggestAssetMemories({
        ownerUserId: OWNER,
        assetId: archived.id,
        sourceRecordId: source.id,
        memories: [{ label: "Note", notes: "Sold it." }],
      }),
    ).rejects.toThrow(AssetValidationError);

    const foreign = await seedSource({ ownerUserId: OUTSIDER });
    await expect(
      review.suggestAssetMemories({
        ownerUserId: OUTSIDER,
        assetId: archived.id,
        sourceRecordId: foreign.id,
        memories: [{ label: "Note", notes: "Hm." }],
      }),
    ).rejects.toThrow("Asset not found.");
  });
});

describe("the review queue", () => {
  it("lists only the owner's still-pending groups, newest first", async () => {
    const { review, seedSuggestedAsset } = setup();
    const first = await seedSuggestedAsset({ name: "Fridge filter" });
    const second = await seedSuggestedAsset({ name: "Furnace filter" });

    const queue = await review.listAssetReviewGroups({ ownerUserId: OWNER });
    expect(queue.map((entry) => entry.group.id)).toEqual([second.group.id, first.group.id]);

    // Resolving every member drops the group from the queue.
    await review.acceptAssetReviewGroup({ actorUserId: OWNER, groupId: second.group.id });
    const after = await review.listAssetReviewGroups({ ownerUserId: OWNER });
    expect(after.map((entry) => entry.group.id)).toEqual([first.group.id]);

    // Owner-scoped: someone else sees nothing.
    await expect(review.listAssetReviewGroups({ ownerUserId: OUTSIDER })).resolves.toEqual([]);
  });
});

describe("accept a suggested asset", () => {
  it("promotes the same row in place to an active Asset", async () => {
    const { review, lifecycle, seedSuggestedAsset, auditKinds } = setup();
    const result = await seedSuggestedAsset();

    const accepted = await review.acceptSuggestedAsset({
      actorUserId: OWNER,
      assetId: result.asset.id,
    });

    expect(accepted.asset.id).toBe(result.asset.id);
    expect(accepted.asset.status).toBe("active");
    expect(accepted.assetPending).toBe(false);
    // Its pending memories stay pending — accepting the anchor is not a batch accept.
    expect(accepted.memories).toHaveLength(2);

    const listed = await lifecycle.listAssets({ callerUserId: OWNER });
    expect(listed.map((asset) => asset.id)).toEqual([result.asset.id]);
    await expect(auditKinds(result.asset.id)).resolves.toContain("promoted");
  });

  it("applies an edit-before-accept correction", async () => {
    const { review, seedSuggestedAsset } = setup();
    const result = await seedSuggestedAsset({ name: "fridge thing" });

    const accepted = await review.acceptSuggestedAsset({
      actorUserId: OWNER,
      assetId: result.asset.id,
      edit: { name: "Refrigerator water filter", kind: "appliance" },
    });
    expect(accepted.asset.name).toBe("Refrigerator water filter");
    expect(accepted.asset.status).toBe("active");
  });

  it("can widen the audience at acceptance, when the owner chooses", async () => {
    const { review, seedSuggestedAsset, seedHousehold } = setup();
    const household = await seedHousehold();
    const result = await seedSuggestedAsset();

    const accepted = await review.acceptSuggestedAsset({
      actorUserId: OWNER,
      assetId: result.asset.id,
      scope: "household",
      householdId: household.id,
    });
    expect(accepted.asset.scope).toBe("household");
    expect(accepted.asset.householdId).toBe(household.id);
  });

  it("is idempotent: re-accepting a promoted proposal returns it unchanged", async () => {
    const { review, seedSuggestedAsset } = setup();
    const result = await seedSuggestedAsset();
    await review.acceptSuggestedAsset({ actorUserId: OWNER, assetId: result.asset.id });

    const again = await review.acceptSuggestedAsset({
      actorUserId: OWNER,
      assetId: result.asset.id,
    });
    expect(again.asset.status).toBe("active");
  });

  it("refuses to silently promote a dismissed proposal", async () => {
    const { review, seedSuggestedAsset } = setup();
    const result = await seedSuggestedAsset();
    await review.dismissSuggestedAsset({ actorUserId: OWNER, assetId: result.asset.id });

    await expect(
      review.acceptSuggestedAsset({ actorUserId: OWNER, assetId: result.asset.id }),
    ).rejects.toThrow(/set aside/i);
  });

  it("is owner-only", async () => {
    const { review, seedSuggestedAsset } = setup();
    const result = await seedSuggestedAsset();
    await expect(
      review.acceptSuggestedAsset({ actorUserId: OUTSIDER, assetId: result.asset.id }),
    ).rejects.toThrow("Asset not found.");
  });
});

describe("edit a suggested asset in place", () => {
  it("corrects content while staying suggested, with an audit trail", async () => {
    const { review, seedSuggestedAsset, auditKinds } = setup();
    const result = await seedSuggestedAsset({ name: "fridge thing" });

    const edited = await review.editSuggestedAsset({
      actorUserId: OWNER,
      assetId: result.asset.id,
      edit: { name: "Refrigerator water filter" },
    });
    expect(edited.asset.name).toBe("Refrigerator water filter");
    expect(edited.asset.status).toBe("suggested");
    await expect(auditKinds(result.asset.id)).resolves.toContain("edited");
  });

  it("rejects an empty edit and an edit to a non-proposal", async () => {
    const { review, lifecycle, seedSuggestedAsset } = setup();
    const result = await seedSuggestedAsset();
    await expect(
      review.editSuggestedAsset({ actorUserId: OWNER, assetId: result.asset.id, edit: {} }),
    ).rejects.toThrow(AssetValidationError);

    const active = await lifecycle.createAsset({ ownerUserId: OWNER, name: "TV", kind: "item" });
    await expect(
      review.editSuggestedAsset({
        actorUserId: OWNER,
        assetId: active.id,
        edit: { name: "Television" },
      }),
    ).rejects.toThrow(/suggested/i);
  });
});

describe("dismiss a suggested asset", () => {
  it("resolves the proposal and cascades its pending details", async () => {
    const { review, seedSuggestedAsset, auditKinds, expectAllMemoriesDismissed } = setup();
    const result = await seedSuggestedAsset();

    const dismissed = await review.dismissSuggestedAsset({
      actorUserId: OWNER,
      assetId: result.asset.id,
    });
    // The cascade resolved the memories too — nothing left pending anywhere.
    await expectAllMemoriesDismissed(dismissed, "dismissed");
    await expect(review.listAssetReviewGroups({ ownerUserId: OWNER })).resolves.toEqual([]);

    const kinds = await auditKinds(result.asset.id);
    expect(kinds).toContain("dismissed");
    expect(kinds.filter((kind) => kind === "memory_dismissed")).toHaveLength(2);
  });
});

describe("review a suggested memory", () => {
  it("requires the anchor to be durable before a detail becomes truth", async () => {
    const { review, seedSuggestedAsset } = setup();
    const result = await seedSuggestedAsset();
    const [first] = result.memories;
    if (!first) throw new Error("expected a suggested memory");

    await expect(
      review.acceptSuggestedAssetMemory({ actorUserId: OWNER, memoryId: first.id }),
    ).rejects.toThrow(/accept the suggested asset|link/i);
  });

  it("promotes a memory in place once the anchor is durable, with provenance", async () => {
    const { review, seedSuggestedAsset, auditKinds } = setup();
    const result = await seedSuggestedAsset();
    await review.acceptSuggestedAsset({ actorUserId: OWNER, assetId: result.asset.id });
    const [first] = result.memories;
    if (!first) throw new Error("expected a suggested memory");

    const after = await review.acceptSuggestedAssetMemory({
      actorUserId: OWNER,
      memoryId: first.id,
    });
    // The group result now shows one remaining pending memory.
    expect(after.memories.map((memory) => memory.id)).not.toContain(first.id);

    const durable = await review.listAssetMemories({
      callerUserId: OWNER,
      assetId: result.asset.id,
    });
    expect(durable.map((memory) => memory.id)).toEqual([first.id]);
    expect(durable[0]?.status).toBe("active");
    expect(durable[0]?.sourceRecordId).toBe(result.group.sourceRecordId);
    await expect(auditKinds(result.asset.id)).resolves.toContain("memory_promoted");
  });

  it("applies an edit-before-accept correction to the detail", async () => {
    const { review, seedSuggestedAsset } = setup();
    const result = await seedSuggestedAsset();
    await review.acceptSuggestedAsset({ actorUserId: OWNER, assetId: result.asset.id });
    const [first] = result.memories;
    if (!first) throw new Error("expected a suggested memory");

    await review.acceptSuggestedAssetMemory({
      actorUserId: OWNER,
      memoryId: first.id,
      edit: { value: { type: "text", text: "EDR4RXD1" }, notes: "Corrected from the box." },
    });
    const durable = await review.listAssetMemories({
      callerUserId: OWNER,
      assetId: result.asset.id,
    });
    expect(durable[0]?.value).toEqual({ type: "text", text: "EDR4RXD1" });
    expect(durable[0]?.notes).toBe("Corrected from the box.");
  });

  it("never silently discards an edit on a re-accepted (already active) detail", async () => {
    const { review, seedSuggestedAsset, auditKinds } = setup();
    const result = await seedSuggestedAsset();
    await review.acceptSuggestedAsset({ actorUserId: OWNER, assetId: result.asset.id });
    const [first] = result.memories;
    if (!first) throw new Error("expected a suggested memory");
    await review.acceptSuggestedAssetMemory({ actorUserId: OWNER, memoryId: first.id });

    // A second accept that carries a correction still lands the correction —
    // the reviewer believes their edit took effect, so it must.
    await review.acceptSuggestedAssetMemory({
      actorUserId: OWNER,
      memoryId: first.id,
      edit: { value: { type: "text", text: "EDR4RXD1" } },
    });

    const durable = await review.listAssetMemories({
      callerUserId: OWNER,
      assetId: result.asset.id,
    });
    const accepted = durable.find((memory) => memory.id === first.id);
    expect(accepted?.status).toBe("active");
    expect(accepted?.value).toEqual({ type: "text", text: "EDR4RXD1" });
    // Still exactly one promotion; the post-accept correction is an edit.
    const kinds = await auditKinds(result.asset.id);
    expect(kinds.filter((kind) => kind === "memory_promoted")).toHaveLength(1);
    expect(kinds).toContain("memory_edited");
  });

  it("edits a suggested memory in place without accepting it", async () => {
    const { review, store, seedSuggestedAsset, auditKinds } = setup();
    const result = await seedSuggestedAsset();
    const [first] = result.memories;
    if (!first) throw new Error("expected a suggested memory");

    const after = await review.editSuggestedAssetMemory({
      actorUserId: OWNER,
      memoryId: first.id,
      edit: { label: "Model number" },
    });
    const edited = after.memories.find((memory) => memory.id === first.id);
    expect(edited?.label).toBe("Model number");
    expect(edited?.status).toBe("suggested");

    const stored = await store.getAssetMemory({ ownerUserId: OWNER, memoryId: first.id });
    expect(stored?.status).toBe("suggested");
    await expect(auditKinds(result.asset.id)).resolves.toContain("memory_edited");
  });

  it("dismisses one detail without touching its siblings", async () => {
    const { review, seedSuggestedAsset, auditKinds } = setup();
    const result = await seedSuggestedAsset();
    const [first, second] = result.memories;
    if (!first || !second) throw new Error("expected two suggested memories");

    const after = await review.dismissSuggestedAssetMemory({
      actorUserId: OWNER,
      memoryId: first.id,
    });
    expect(after.memories.map((memory) => memory.id)).toEqual([second.id]);
    await expect(auditKinds(result.asset.id)).resolves.toContain("memory_dismissed");

    await expect(
      review.acceptSuggestedAssetMemory({ actorUserId: OWNER, memoryId: first.id }),
    ).rejects.toThrow(/set aside/i);
  });
});

describe("batch review", () => {
  it("accepts a whole low-risk group at once, idempotently", async () => {
    const { review, lifecycle, seedSuggestedAsset } = setup();
    const result = await seedSuggestedAsset();

    const accepted = await review.acceptAssetReviewGroup({
      actorUserId: OWNER,
      groupId: result.group.id,
    });
    expect(accepted.asset.status).toBe("active");
    expect(accepted.memories).toEqual([]);

    const durable = await review.listAssetMemories({
      callerUserId: OWNER,
      assetId: result.asset.id,
    });
    expect(durable).toHaveLength(2);
    const listed = await lifecycle.listAssets({ callerUserId: OWNER });
    expect(listed.map((asset) => asset.id)).toEqual([result.asset.id]);

    // Re-running the batch changes nothing.
    const again = await review.acceptAssetReviewGroup({
      actorUserId: OWNER,
      groupId: result.group.id,
    });
    expect(again.asset.status).toBe("active");
    await expect(
      review.listAssetMemories({ callerUserId: OWNER, assetId: result.asset.id }),
    ).resolves.toHaveLength(2);
  });

  it("dismisses a whole group at once", async () => {
    const { review, seedSuggestedAsset, expectAllMemoriesDismissed } = setup();
    const result = await seedSuggestedAsset();

    const dismissed = await review.dismissAssetReviewGroup({
      actorUserId: OWNER,
      groupId: result.group.id,
    });
    await expectAllMemoriesDismissed(dismissed, "dismissed");
  });

  it("dismisses only the pending details when the anchor is an existing asset", async () => {
    const { review, seedExistingAssetGroup, expectAllMemoriesDismissed } = setup();
    const { result } = await seedExistingAssetGroup();

    const dismissed = await review.dismissAssetReviewGroup({
      actorUserId: OWNER,
      groupId: result.group.id,
    });
    // The durable anchor is untouched; only the pending details are set aside.
    await expectAllMemoriesDismissed(dismissed, "active");
  });
});

describe("duplicate review: link to an existing asset", () => {
  async function linkSetup() {
    const context = setup();
    const existing = await context.lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Refrigerator water filter",
      kind: "appliance",
    });
    const result = await context.seedSuggestedAsset({ name: "fridge filter" });
    return { ...context, existing, result };
  }

  it("re-anchors the pending details instead of creating a near-duplicate", async () => {
    const { review, lifecycle, existing, result, auditKinds } = await linkSetup();

    const linked = await review.linkAssetReviewGroup({
      actorUserId: OWNER,
      groupId: result.group.id,
      targetAssetId: existing.id,
    });

    expect(linked.asset.id).toBe(existing.id);
    expect(linked.assetPending).toBe(false);
    expect(linked.duplicateCandidates).toEqual([]);
    expect(linked.memories).toHaveLength(2);
    expect(linked.memories.every((memory) => memory.assetId === existing.id)).toBe(true);

    // The would-be duplicate never becomes a durable asset.
    const listed = await lifecycle.listAssets({ callerUserId: OWNER });
    expect(listed.map((asset) => asset.id)).toEqual([existing.id]);

    // Accepting a linked detail lands it on the existing asset.
    const [first] = linked.memories;
    if (!first) throw new Error("expected a linked memory");
    await review.acceptSuggestedAssetMemory({ actorUserId: OWNER, memoryId: first.id });
    const durable = await review.listAssetMemories({ callerUserId: OWNER, assetId: existing.id });
    expect(durable.map((memory) => memory.id)).toEqual([first.id]);

    // Both sides of the link carry the audit trail.
    await expect(auditKinds(result.asset.id)).resolves.toContain("linked_existing");
    await expect(auditKinds(existing.id)).resolves.toContain("linked_existing");
  });

  it("clamps a linked detail's visibility to what the target allows", async () => {
    const { review, store, seedSuggestedAsset, seedHousehold, lifecycle } = setup();
    const household = await seedHousehold();
    const privateTarget = await lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Refrigerator water filter",
      kind: "appliance",
    });
    const result = await seedSuggestedAsset({
      name: "fridge filter",
      scope: "household",
      householdId: household.id,
    });

    await review.linkAssetReviewGroup({
      actorUserId: OWNER,
      groupId: result.group.id,
      targetAssetId: privateTarget.id,
    });

    const memories = await store.listAssetMemoriesForOwner({
      ownerUserId: OWNER,
      assetId: privateTarget.id,
    });
    expect(memories).toHaveLength(2);
    expect(memories.every((memory) => memory.scope === "private")).toBe(true);
    expect(memories.every((memory) => memory.householdId === null)).toBe(true);
  });

  it("rebuilds linked child shares within a selected-shared target audience", async () => {
    const { review, store, seedSuggestedAsset, seedHousehold, lifecycle } = setup();
    const household = await seedHousehold();
    const sharedTarget = await lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Refrigerator water filter",
      kind: "appliance",
      scope: "shared",
      householdId: household.id,
      selectedUserIds: [MEMBER],
    });
    const result = await seedSuggestedAsset({
      name: "fridge filter",
      scope: "household",
      householdId: household.id,
    });

    await review.linkAssetReviewGroup({
      actorUserId: OWNER,
      groupId: result.group.id,
      targetAssetId: sharedTarget.id,
    });

    const memories = await store.listAssetMemoriesForOwner({
      ownerUserId: OWNER,
      assetId: sharedTarget.id,
    });
    expect(memories.every((memory) => memory.scope === "shared")).toBe(true);
    for (const memory of memories) {
      const shares = await store.listHouseholdRecordShares({
        householdId: household.id,
        recordKind: "asset_memory",
        recordId: memory.id,
      });
      expect(shares.map((share) => share.sharedWithUserId)).toEqual([MEMBER]);
    }
  });

  it("narrows a shared child to private when re-anchoring across households", async () => {
    const { review, store, seedSource, seedHousehold, lifecycle } = setup();
    const firstHousehold = await seedHousehold();
    const secondHousehold = await seedOwnerMemberHousehold(store, OUTSIDER, OWNER);
    const target = await lifecycle.createAsset({
      ownerUserId: OUTSIDER,
      name: "Garage refrigerator",
      kind: "appliance",
      scope: "household",
      householdId: secondHousehold.id,
    });
    const source = await seedSource();
    const result = await review.suggestAsset({
      ownerUserId: OWNER,
      name: "fridge filter",
      kind: "appliance",
      scope: "household",
      householdId: firstHousehold.id,
      sourceRecordId: source.id,
      memories: [
        {
          label: "Filter model",
          value: { type: "text", text: "EDR3RXD1" },
          scope: "shared",
          selectedUserIds: [MEMBER],
        },
      ],
    });

    const linked = await review.linkAssetReviewGroup({
      actorUserId: OWNER,
      groupId: result.group.id,
      targetAssetId: target.id,
    });
    expect(linked.memories[0]?.scope).toBe("private");
    expect(linked.memories[0]?.householdId).toBeNull();
    const staleShares = await store.listHouseholdRecordShares({
      householdId: firstHousehold.id,
      recordKind: "asset_memory",
      recordId: linked.memories[0]?.id ?? "missing",
    });
    expect(staleShares).toEqual([]);
  });

  it("rejects linking to itself, to a non-visible target, or from a durable anchor", async () => {
    const { review, lifecycle, existing, result } = await linkSetup();

    await expect(
      review.linkAssetReviewGroup({
        actorUserId: OWNER,
        groupId: result.group.id,
        targetAssetId: result.asset.id,
      }),
    ).rejects.toThrow(AssetValidationError);

    await expect(
      review.linkAssetReviewGroup({
        actorUserId: OUTSIDER,
        groupId: result.group.id,
        targetAssetId: existing.id,
      }),
    ).rejects.toThrow(/not found/i);

    // Once accepted, the anchor is durable — there is nothing left to link.
    await review.acceptSuggestedAsset({ actorUserId: OWNER, assetId: result.asset.id });
    const another = await lifecycle.createAsset({ ownerUserId: OWNER, name: "X", kind: "item" });
    await expect(
      review.linkAssetReviewGroup({
        actorUserId: OWNER,
        groupId: result.group.id,
        targetAssetId: another.id,
      }),
    ).rejects.toThrow(AssetValidationError);
  });
});

describe("memory visibility filtering", () => {
  it("filters each detail independently of its household asset", async () => {
    const { review, lifecycle, seedHousehold } = setup();
    const household = await seedHousehold();
    const asset = await lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Kitchen refrigerator",
      kind: "appliance",
      scope: "household",
      householdId: household.id,
    });

    await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: asset.id,
      label: "Filter model",
      value: { type: "text", text: "EDR3RXD1" },
      scope: "household",
    });
    await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: asset.id,
      label: "Paid",
      value: { type: "amount", amount: 1899, currency: "USD" },
      scope: "private",
    });

    const ownerSees = await review.listAssetMemories({ callerUserId: OWNER, assetId: asset.id });
    // Sorted: both rows can share a created-at millisecond, and the random-id
    // tiebreak is unordered — this test is about filtering, not ordering.
    expect(ownerSees.map((memory) => memory.label).sort()).toEqual(["Filter model", "Paid"]);

    // The member sees the household detail, never the private one.
    const memberSees = await review.listAssetMemories({ callerUserId: MEMBER, assetId: asset.id });
    expect(memberSees.map((memory) => memory.label)).toEqual(["Filter model"]);

    // An outsider sees nothing at all.
    await expect(
      review.listAssetMemories({ callerUserId: OUTSIDER, assetId: asset.id }),
    ).resolves.toEqual([]);
  });

  it("never leaks suggested details into visible reads", async () => {
    const { review, lifecycle, seedHousehold, seedSource } = setup();
    const household = await seedHousehold();
    const asset = await lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Kitchen refrigerator",
      kind: "appliance",
      scope: "household",
      householdId: household.id,
    });
    const source = await seedSource();
    await review.suggestAssetMemories({
      ownerUserId: OWNER,
      assetId: asset.id,
      sourceRecordId: source.id,
      memories: [{ label: "Filter model", value: { type: "text", text: "EDR3RXD1" } }],
    });

    await expect(
      review.listAssetMemories({ callerUserId: MEMBER, assetId: asset.id }),
    ).resolves.toEqual([]);
    await expect(
      review.listAssetMemories({ callerUserId: OWNER, assetId: asset.id }),
    ).resolves.toEqual([]);
  });
});

describe("explicit asset memory creation", () => {
  it("creates a durable active memory with audit provenance", async () => {
    const { review, lifecycle, auditKinds } = setup();
    const asset = await lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Toyota Corolla",
      kind: "vehicle",
    });

    const memory = await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: asset.id,
      label: "Oil filter",
      value: { type: "text", text: "Toyota 90915-YZZF1" },
    });
    expect(memory.status).toBe("active");
    expect(memory.createdByUserId).toBe(OWNER);
    await expect(auditKinds(asset.id)).resolves.toContain("memory_created");
  });

  it("enforces the child-scope ceiling on explicit creation", async () => {
    const { review, lifecycle, seedHousehold } = setup();
    await seedHousehold();
    const asset = await lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Toyota Corolla",
      kind: "vehicle",
    });

    await expect(
      review.createActiveAssetMemory({
        ownerUserId: OWNER,
        assetId: asset.id,
        label: "Location",
        notes: "Garage",
        scope: "household",
      }),
    ).rejects.toThrow(AssetValidationError);
  });

  it("keeps explicit memories private unless the user widens them", async () => {
    const { review, lifecycle, seedHousehold } = setup();
    const household = await seedHousehold();
    const asset = await lifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Toyota Corolla",
      kind: "vehicle",
      scope: "household",
      householdId: household.id,
    });

    const memory = await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: asset.id,
      label: "Parking spot",
      notes: "Level two",
    });
    expect(memory.scope).toBe("private");
    expect(memory.householdId).toBeNull();
  });
});
