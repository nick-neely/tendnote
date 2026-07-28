import type { AffectedScope } from "@tendnote/db/queries/general-actions";
import { revalidatePath, revalidateTag, updateTag } from "next/cache";
import { actionCacheContract } from "./action-views";
import { assetCacheContract } from "./asset-views";
import { peopleCacheContract } from "./people-contract";
import { todayReviewCacheContract } from "./today-review-views";

export type ReconciliationOrigin = "background" | "owner-action";

/**
 * Translates framework-neutral mutation scopes into Next.js cache effects.
 *
 * Direct owner actions synchronously expire tags for read-your-writes. Background
 * writers preserve truthful stale content while the same scopes refresh.
 */
// fallow-ignore-next-line complexity -- This exhaustive adapter deliberately centralizes every affected-scope-to-tag-and-route branch.
export function reconcileAffectedScopes(
  scopes: readonly AffectedScope[],
  input: { origin: ReconciliationOrigin },
) {
  const tags = new Set(scopes.flatMap(tagsForAffectedScope));
  for (const tag of tags) {
    if (input.origin === "owner-action") updateTag(tag);
    else revalidateTag(tag, "max");
  }

  // Route calls remain the ADR-0206 migration safety net until the final
  // tag-coverage ticket proves each family is fully expressed by tags.
  const personIds = new Set<string>();
  const assetIds = new Set<string>();
  let actions = false;
  let account = false;
  let assets = false;
  let briefs = false;
  let people = false;
  let savedItems = false;
  let today = false;
  let review = false;
  for (const scope of scopes) {
    if (scope.kind === "owner-collection" && scope.collection === "account") {
      account = true;
    } else if (scope.kind === "owner-collection" && scope.collection === "briefs") {
      briefs = true;
    } else if (
      (scope.kind === "viewer-collection" && scope.collection === "general-actions") ||
      (scope.kind === "viewer-entity" && scope.entity === "general-action") ||
      scope.kind === "linked-entity"
    ) {
      actions = true;
    } else if (
      (scope.kind === "owner-collection" && scope.collection === "assets") ||
      (scope.kind === "viewer-collection" && scope.collection === "assets") ||
      (scope.kind === "viewer-entity" && scope.entity === "asset") ||
      (scope.kind === "visible-entity" && scope.entity === "asset") ||
      (scope.kind === "household-collection" && scope.collection === "assets")
    ) {
      assets = true;
      if (
        (scope.kind === "viewer-entity" || scope.kind === "visible-entity") &&
        scope.entity === "asset"
      ) {
        assetIds.add(scope.entityId);
      }
    } else if (
      (scope.kind === "owner-collection" && scope.collection === "saved-items") ||
      (scope.kind === "viewer-collection" && scope.collection === "saved-items") ||
      (scope.kind === "viewer-entity" && scope.entity === "saved-item") ||
      (scope.kind === "visible-entity" && scope.entity === "saved-item") ||
      (scope.kind === "household-collection" && scope.collection === "saved-items")
    ) {
      savedItems = true;
    } else if (
      (scope.kind === "owner-collection" && scope.collection === "people") ||
      (scope.kind === "viewer-entity" && scope.entity === "person") ||
      scope.kind === "visible-entity"
    ) {
      people = true;
      if (scope.kind !== "owner-collection") personIds.add(scope.entityId);
    } else if (scope.kind === "owner-collection" && scope.collection === "today") {
      today = true;
    } else if (scope.kind === "owner-collection" && scope.collection === "review") {
      review = true;
    }
  }

  if (input.origin !== "owner-action") {
    // Account and Brief reads do not yet have cache-tag contracts. Keep background
    // callbacks effective during the migration instead of silently translating
    // these scopes to no cache operation.
    if (account) {
      revalidatePath("/account");
      revalidatePath("/account/contacts/import");
      revalidatePath("/account/discord");
    }
    if (briefs) revalidatePath("/");
    return;
  }

  if (actions) revalidatePath("/actions");
  if (account) {
    revalidatePath("/account");
    revalidatePath("/account/contacts/import");
    revalidatePath("/account/discord");
  }
  if (assets) revalidatePath("/assets");
  for (const assetId of assetIds) revalidatePath(`/assets/${assetId}`);
  if (people) revalidatePath("/people");
  for (const personId of personIds) revalidatePath(`/people/${personId}`);
  if (actions || today) revalidatePath("/actions/today");
  if (briefs || today || review) revalidatePath("/");
  if (savedItems) revalidatePath("/saved-items");
}

export function tagsForAffectedScope(scope: AffectedScope): readonly string[] {
  if (scope.kind === "viewer-collection") return tagsForViewerCollection(scope);
  if (scope.kind === "viewer-entity") return tagsForViewerEntity(scope);
  if (scope.kind === "visible-entity") return tagsForVisibleEntity(scope);
  if (scope.kind === "household-collection") return tagsForHouseholdCollection(scope);
  if (scope.kind === "linked-entity") return [actionCacheContract.linkedAsset(scope.entityId)];
  return tagsForOwnerCollection(scope);
}

function tagsForViewerCollection(
  scope: Extract<AffectedScope, { kind: "viewer-collection" }>,
): readonly string[] {
  if (scope.collection === "general-actions") {
    return actionCacheContract.owner(scope.viewerUserId).tags;
  }
  return scope.collection === "assets"
    ? assetCacheContract.assetCollection(scope.viewerUserId)
    : [
        ...assetCacheContract.savedItemCollection(scope.viewerUserId),
        assetCacheContract.savedItemReminders(scope.viewerUserId),
      ];
}

function tagsForViewerEntity(
  scope: Extract<AffectedScope, { kind: "viewer-entity" }>,
): readonly string[] {
  if (scope.entity === "general-action") {
    return [actionCacheContract.entity(scope.viewerUserId, scope.entityId)];
  }
  if (scope.entity === "person") {
    return [peopleCacheContract.tags.entity(scope.viewerUserId, scope.entityId)];
  }
  return scope.entity === "asset"
    ? [assetCacheContract.assetEntity(scope.viewerUserId, scope.entityId)]
    : [assetCacheContract.savedItemEntity(scope.viewerUserId, scope.entityId)];
}

function tagsForVisibleEntity(
  scope: Extract<AffectedScope, { kind: "visible-entity" }>,
): readonly string[] {
  if (scope.entity === "person") {
    return [peopleCacheContract.tags.allViewersEntity(scope.entityId)];
  }
  return scope.entity === "asset"
    ? [assetCacheContract.visibleAssetEntity(scope.entityId)]
    : [assetCacheContract.visibleSavedItemEntity(scope.entityId)];
}

function tagsForHouseholdCollection(
  scope: Extract<AffectedScope, { kind: "household-collection" }>,
): readonly string[] {
  return scope.collection === "assets"
    ? [assetCacheContract.householdAssetCollection(scope.householdId)]
    : [assetCacheContract.householdSavedItemCollection(scope.householdId)];
}

function tagsForOwnerCollection(
  scope: Extract<AffectedScope, { kind: "owner-collection" }>,
): readonly string[] {
  if (scope.collection === "account" || scope.collection === "briefs") {
    return [];
  }
  if (scope.collection === "assets") {
    return assetCacheContract.assetCollection(scope.ownerUserId);
  }
  if (scope.collection === "saved-items") {
    return [
      ...assetCacheContract.savedItemCollection(scope.ownerUserId),
      assetCacheContract.savedItemReminders(scope.ownerUserId),
    ];
  }
  if (scope.collection === "people") {
    return [
      peopleCacheContract.tags.owner(scope.ownerUserId),
      peopleCacheContract.tags.collection(scope.ownerUserId),
    ];
  }
  if (scope.collection === "today") {
    return todayReviewCacheContract.todayOwnerTags(scope.ownerUserId);
  }
  return todayReviewCacheContract.review({ ownerUserId: scope.ownerUserId }).tags;
}
