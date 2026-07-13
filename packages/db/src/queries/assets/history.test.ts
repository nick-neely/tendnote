import { describe, expect, it } from "vitest";
import { createGeneralActionLifecycle } from "../general-actions/lifecycle";
import { seedHouseholdWithMembers } from "../households/household-fixtures";
import { createAssetHistory } from "./history";
import { createInMemoryAssetActionLinkStore } from "./in-memory-action-link-store";
import { createAssetLifecycle } from "./lifecycle";
import { createAssetReview } from "./review";

const OWNER = "user-1";
const MEMBER = "user-member";

/**
 * Separates two write phases onto distinct clock milliseconds. The seam stamps
 * real clock times, so a whole seed can land within one millisecond and make
 * "newest first" assertions depend on tie-break order instead of time — this
 * keeps the ordering assertion about timestamps, which is what the seam sorts by.
 */
function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 2));
}

function setup() {
  const store = createInMemoryAssetActionLinkStore();
  const history = createAssetHistory(store);
  const assetLifecycle = createAssetLifecycle(store);
  const actionLifecycle = createGeneralActionLifecycle(store);
  const review = createAssetReview(store);

  function seedHousehold() {
    return seedHouseholdWithMembers(store, {
      ownerUserId: OWNER,
      members: [
        [OWNER, "owner"],
        [MEMBER, "member"],
      ],
    });
  }

  return { store, history, assetLifecycle, actionLifecycle, review, seedHousehold };
}

describe("listAssetHistory", () => {
  it("derives one story from the asset's lifecycle, reviewed memories, and linked action history", async () => {
    const { store, history, assetLifecycle, actionLifecycle, review } = setup();
    const asset = await assetLifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Refrigerator",
      kind: "appliance",
    });
    await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: asset.id,
      label: "Filter size",
      value: { type: "text", text: "EDR3RXD1" },
    });
    const action = await actionLifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Replace the refrigerator water filter",
    });
    await store.createGeneralActionAssetLink({
      ownerUserId: OWNER,
      generalActionId: action.id,
      assetId: asset.id,
      hintLabel: null,
    });
    await nextTick();
    await actionLifecycle.completeGeneralAction({ actorUserId: OWNER, generalActionId: action.id });

    const entries = await history.listAssetHistory({ callerUserId: OWNER, assetId: asset.id });

    // Newest first: complete → action created → memory → asset added (same-instant
    // creations settle deterministically; assert membership + the completion lead).
    expect(entries[0]).toMatchObject({
      type: "action",
      event: "completed",
      actionTitle: "Replace the refrigerator water filter",
    });
    expect(entries.filter((entry) => entry.type === "memory")).toHaveLength(1);
    expect(entries.some((entry) => entry.type === "asset" && entry.event === "added")).toBe(true);
    expect(entries.some((entry) => entry.type === "action" && entry.event === "created")).toBe(
      true,
    );
  });

  it("keeps the general action's own lifecycle authoritative — archive shows up without any asset-side write", async () => {
    const { history, assetLifecycle } = setup();
    const asset = await assetLifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Refrigerator",
      kind: "appliance",
    });
    await assetLifecycle.archiveAsset({ actorUserId: OWNER, assetId: asset.id });
    await assetLifecycle.restoreAsset({ actorUserId: OWNER, assetId: asset.id });

    const entries = await history.listAssetHistory({ callerUserId: OWNER, assetId: asset.id });
    expect(entries.map((entry) => entry.type === "asset" && entry.event)).toEqual([
      "restored",
      "archived",
      "added",
    ]);
  });

  it("filters every source per record for the caller", async () => {
    const { store, history, assetLifecycle, actionLifecycle, review, seedHousehold } = setup();
    const household = await seedHousehold();
    const asset = await assetLifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Refrigerator",
      kind: "appliance",
      scope: "household",
      householdId: household.id,
    });
    // A private detail under the household asset — the member never sees it.
    await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: asset.id,
      label: "Purchase price",
      value: { type: "amount", amount: 1899, currency: "USD" },
      scope: "private",
    });
    // A household detail both see.
    await review.createActiveAssetMemory({
      ownerUserId: OWNER,
      assetId: asset.id,
      label: "Filter size",
      value: { type: "text", text: "EDR3RXD1" },
      scope: "household",
    });
    // A private linked action — its history stays the owner's.
    const privateAction = await actionLifecycle.createGeneralAction({
      ownerUserId: OWNER,
      title: "Buy a spare filter",
    });
    await store.createGeneralActionAssetLink({
      ownerUserId: OWNER,
      generalActionId: privateAction.id,
      assetId: asset.id,
      hintLabel: null,
    });

    const memberEntries = await history.listAssetHistory({
      callerUserId: MEMBER,
      assetId: asset.id,
    });
    const memberMemoryLabels = memberEntries.flatMap((entry) =>
      entry.type === "memory" ? [entry.label] : [],
    );
    expect(memberMemoryLabels).toEqual(["Filter size"]);
    expect(memberEntries.some((entry) => entry.type === "action")).toBe(false);
    // The asset's own lifecycle is visible to everyone who can see the asset.
    expect(memberEntries.some((entry) => entry.type === "asset" && entry.event === "added")).toBe(
      true,
    );

    const ownerEntries = await history.listAssetHistory({ callerUserId: OWNER, assetId: asset.id });
    expect(ownerEntries.some((entry) => entry.type === "action" && entry.event === "created")).toBe(
      true,
    );
  });

  it("returns nothing for an asset the caller cannot see", async () => {
    const { history, assetLifecycle } = setup();
    const asset = await assetLifecycle.createAsset({
      ownerUserId: OWNER,
      name: "Refrigerator",
      kind: "appliance",
    });

    await expect(
      history.listAssetHistory({ callerUserId: "user-stranger", assetId: asset.id }),
    ).resolves.toEqual([]);
  });
});
