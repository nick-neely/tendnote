import { beforeEach, describe, expect, it, vi } from "vitest";

const { revalidatePath, updateTag } = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath, updateTag }));

import { assetMutationScopes, updateAssetMutationScopes } from "./asset-mutation-scopes";

describe("Asset mutation scopes", () => {
  beforeEach(() => {
    revalidatePath.mockReset();
    updateTag.mockReset();
  });

  it("keeps Asset and Saved Item invalidation typed and caller-scoped", () => {
    expect(assetMutationScopes.forAsset({ callerUserId: "owner-a", assetId: "asset-1" })).toEqual([
      { kind: "asset-collection", callerUserId: "owner-a" },
      { kind: "asset-entity", callerUserId: "owner-a", assetId: "asset-1" },
      { kind: "asset-visible-to-viewers", assetId: "asset-1" },
      { kind: "action-linked-asset", assetId: "asset-1" },
      { kind: "today-owner", callerUserId: "owner-a" },
      { kind: "review-owner", callerUserId: "owner-a" },
    ]);
    const savedItemScopes = assetMutationScopes.forSavedItem({
      callerUserId: "owner-b",
      savedItemId: "item-1",
      sharedWithUserIds: ["viewer-c"],
    });
    expect(savedItemScopes).toContainEqual({
      kind: "saved-item-entity",
      callerUserId: "owner-b",
      savedItemId: "item-1",
    });
    expect(savedItemScopes).toContainEqual({
      kind: "saved-item-collection",
      callerUserId: "viewer-c",
    });
    expect(savedItemScopes).toContainEqual({
      kind: "saved-item-reminders",
      callerUserId: "viewer-c",
    });
  });

  it("invalidates a bounded shared audience without putting visibility in cache identity", () => {
    expect(
      assetMutationScopes.forAsset({
        callerUserId: "owner-a",
        assetId: "asset-1",
        householdId: "household-1",
        sharedWithUserIds: ["viewer-b"],
      }),
    ).toEqual(
      expect.arrayContaining([
        { kind: "asset-collection", callerUserId: "owner-a" },
        { kind: "asset-collection", callerUserId: "viewer-b" },
        { kind: "asset-visible-to-viewers", assetId: "asset-1" },
        { kind: "action-linked-asset", assetId: "asset-1" },
        { kind: "asset-household-collection", householdId: "household-1" },
      ]),
    );
  });

  it("expires visible-entity and household tags before falling back to affected paths", () => {
    updateAssetMutationScopes(
      assetMutationScopes.forAsset({
        callerUserId: "owner-a",
        assetId: "asset-1",
        householdId: "household-1",
        sharedWithUserIds: ["viewer-b"],
      }),
    );

    expect(updateTag).toHaveBeenCalledWith("asset:viewer:owner-a:collection");
    expect(updateTag).toHaveBeenCalledWith("asset:viewer:viewer-b:collection");
    expect(updateTag).toHaveBeenCalledWith("asset:visible:asset:asset-1");
    expect(updateTag).toHaveBeenCalledWith("action:linked-asset:asset-1");
    expect(updateTag).toHaveBeenCalledWith("asset:household:household-1:collection");
    expect(revalidatePath).toHaveBeenCalledWith("/assets/asset-1");
    expect(revalidatePath).toHaveBeenCalledWith("/saved-items");
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });
});
