import { describe, expect, it } from "vitest";
import { assetCacheContract } from "./asset-views";

describe("Asset cache contract", () => {
  it("keys Asset and Saved Item collections by the verified caller and names entity tags", () => {
    expect(assetCacheContract.assetCollection("owner-a")).toEqual([
      "asset:viewer:owner-a",
      "asset:viewer:owner-a:collection",
    ]);
    expect(assetCacheContract.assetCollection("owner-b")).not.toEqual(
      assetCacheContract.assetCollection("owner-a"),
    );
    expect(assetCacheContract.assetEntity("owner-a", "asset-1")).toBe(
      "asset:viewer:owner-a:asset:asset-1",
    );
    expect(assetCacheContract.visibleAssetEntity("asset-1")).toBe("asset:visible:asset:asset-1");
    expect(assetCacheContract.householdAssetCollection("household-1")).toBe(
      "asset:household:household-1:collection",
    );
    expect(assetCacheContract.savedItemEntity("owner-a", "item-1")).toBe(
      "saved-item:viewer:owner-a:item:item-1",
    );
    expect(assetCacheContract.visibleSavedItemEntity("item-1")).toBe(
      "saved-item:visible:item:item-1",
    );
  });

  it("keeps a shared record's owner and viewer entries isolated while sharing only an invalidation tag", () => {
    expect(assetCacheContract.assetEntity("owner-a", "asset-1")).not.toBe(
      assetCacheContract.assetEntity("viewer-b", "asset-1"),
    );
    expect(assetCacheContract.savedItemEntity("owner-a", "item-1")).not.toBe(
      assetCacheContract.savedItemEntity("viewer-b", "item-1"),
    );
    expect(assetCacheContract.visibleAssetEntity("asset-1")).not.toContain("owner-a");
    expect(assetCacheContract.visibleAssetEntity("asset-1")).not.toContain("viewer-b");
  });
});
