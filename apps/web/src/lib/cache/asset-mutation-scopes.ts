import { revalidatePath, updateTag } from "next/cache";
import { actionCacheContract } from "./action-views";
import { assetCacheContract } from "./asset-views";
import { todayReviewCacheContract } from "./today-review-views";

export type AssetMutationScope =
  | { kind: "asset-collection"; callerUserId: string }
  | { assetId: string; callerUserId: string; kind: "asset-entity" }
  | { assetId: string; kind: "asset-visible-to-viewers" }
  | { assetId: string; kind: "action-linked-asset" }
  | { householdId: string; kind: "asset-household-collection" }
  | { kind: "saved-item-collection"; callerUserId: string }
  | { callerUserId: string; kind: "saved-item-entity"; savedItemId: string }
  | { kind: "saved-item-visible-to-viewers"; savedItemId: string }
  | { householdId: string; kind: "saved-item-household-collection" }
  | { callerUserId: string; kind: "saved-item-reminders" }
  | { callerUserId: string; kind: "today-owner" }
  | { callerUserId: string; kind: "review-owner" };

export const assetMutationScopes = {
  forAssetIds(input: { assetIds: string[]; callerUserId: string }): AssetMutationScope[] {
    const assetIds = [...new Set(input.assetIds)];
    return [
      { kind: "asset-collection", callerUserId: input.callerUserId },
      ...assetIds.flatMap((assetId): AssetMutationScope[] => [
        { kind: "asset-entity", callerUserId: input.callerUserId, assetId },
        { kind: "asset-visible-to-viewers", assetId },
        { kind: "action-linked-asset", assetId },
      ]),
      { kind: "today-owner", callerUserId: input.callerUserId },
      { kind: "review-owner", callerUserId: input.callerUserId },
    ];
  },
  forAsset(input: {
    assetId: string;
    callerUserId: string;
    householdId?: string | null;
    sharedWithUserIds?: string[];
  }): AssetMutationScope[] {
    const viewerUserIds = new Set([input.callerUserId, ...(input.sharedWithUserIds ?? [])]);
    return [
      ...[...viewerUserIds].map(
        (callerUserId): AssetMutationScope => ({ kind: "asset-collection", callerUserId }),
      ),
      { kind: "asset-entity", callerUserId: input.callerUserId, assetId: input.assetId },
      { kind: "asset-visible-to-viewers", assetId: input.assetId },
      { kind: "action-linked-asset", assetId: input.assetId },
      ...(input.householdId
        ? ([
            {
              kind: "asset-household-collection",
              householdId: input.householdId,
            },
          ] satisfies AssetMutationScope[])
        : []),
      { kind: "today-owner", callerUserId: input.callerUserId },
      { kind: "review-owner", callerUserId: input.callerUserId },
    ];
  },
  forSavedItem(input: {
    callerUserId: string;
    householdId?: string | null;
    savedItemId: string;
    sharedWithUserIds?: string[];
  }): AssetMutationScope[] {
    const viewerUserIds = new Set([input.callerUserId, ...(input.sharedWithUserIds ?? [])]);
    return [
      ...[...viewerUserIds].flatMap((callerUserId): AssetMutationScope[] => [
        { kind: "saved-item-collection", callerUserId },
        { kind: "saved-item-reminders", callerUserId },
      ]),
      {
        kind: "saved-item-entity",
        callerUserId: input.callerUserId,
        savedItemId: input.savedItemId,
      },
      { kind: "saved-item-visible-to-viewers", savedItemId: input.savedItemId },
      ...(input.householdId
        ? ([
            { kind: "saved-item-household-collection", householdId: input.householdId },
          ] satisfies AssetMutationScope[])
        : []),
      { kind: "today-owner", callerUserId: input.callerUserId },
      { kind: "review-owner", callerUserId: input.callerUserId },
    ];
  },
};

/** Synchronously expires direct-write projections before the authoritative view returns. */
export function updateAssetMutationScopes(scopes: AssetMutationScope[]) {
  const assetIds = new Set<string>();
  for (const scope of scopes) {
    switch (scope.kind) {
      case "asset-collection":
        for (const tag of assetCacheContract.assetCollection(scope.callerUserId)) updateTag(tag);
        break;
      case "asset-entity":
        updateTag(assetCacheContract.assetEntity(scope.callerUserId, scope.assetId));
        assetIds.add(scope.assetId);
        break;
      case "asset-visible-to-viewers":
        updateTag(assetCacheContract.visibleAssetEntity(scope.assetId));
        assetIds.add(scope.assetId);
        break;
      case "action-linked-asset":
        updateTag(actionCacheContract.linkedAsset(scope.assetId));
        break;
      case "asset-household-collection":
        updateTag(assetCacheContract.householdAssetCollection(scope.householdId));
        break;
      case "saved-item-collection":
        for (const tag of assetCacheContract.savedItemCollection(scope.callerUserId))
          updateTag(tag);
        break;
      case "saved-item-entity":
        updateTag(assetCacheContract.savedItemEntity(scope.callerUserId, scope.savedItemId));
        break;
      case "saved-item-visible-to-viewers":
        updateTag(assetCacheContract.visibleSavedItemEntity(scope.savedItemId));
        break;
      case "saved-item-household-collection":
        updateTag(assetCacheContract.householdSavedItemCollection(scope.householdId));
        break;
      case "saved-item-reminders":
        updateTag(assetCacheContract.savedItemReminders(scope.callerUserId));
        break;
      case "today-owner":
        for (const tag of todayReviewCacheContract.todayOwnerTags(scope.callerUserId))
          updateTag(tag);
        break;
      case "review-owner":
        for (const tag of todayReviewCacheContract.review({ ownerUserId: scope.callerUserId }).tags)
          updateTag(tag);
        break;
    }
  }
  revalidatePath("/assets");
  revalidatePath("/saved-items");
  revalidatePath("/");
  for (const assetId of assetIds) revalidatePath(`/assets/${assetId}`);
}
