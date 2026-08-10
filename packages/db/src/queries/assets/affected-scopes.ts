import type { AffectedScope } from "../affected-scopes";

type AssetScopeContext = {
  id: string;
  ownerUserId: string;
  householdId?: string | null;
  sharedWithUserIds?: readonly string[];
};

function ownerSurfaceScopes(ownerUserId: string): AffectedScope[] {
  return [
    { kind: "owner-collection", collection: "today", ownerUserId },
    { kind: "owner-collection", collection: "review", ownerUserId },
  ];
}

export function affectedScopesForAsset(asset: AssetScopeContext): AffectedScope[] {
  const viewers = new Set([asset.ownerUserId, ...(asset.sharedWithUserIds ?? [])]);
  return [
    { kind: "owner-collection", collection: "assets", ownerUserId: asset.ownerUserId },
    ...[...viewers].map(
      (viewerUserId): AffectedScope => ({
        kind: "viewer-collection",
        collection: "assets",
        viewerUserId,
      }),
    ),
    {
      kind: "viewer-entity",
      entity: "asset",
      entityId: asset.id,
      viewerUserId: asset.ownerUserId,
    },
    { kind: "visible-entity", entity: "asset", entityId: asset.id },
    { kind: "linked-entity", entity: "asset", entityId: asset.id },
    ...(asset.householdId
      ? ([
          {
            kind: "household-collection",
            collection: "assets",
            householdId: asset.householdId,
          },
        ] satisfies AffectedScope[])
      : []),
    ...ownerSurfaceScopes(asset.ownerUserId),
  ];
}

export function affectedScopesForAssetIds(input: {
  ownerUserId: string;
  assetIds: readonly string[];
}): AffectedScope[] {
  const assetIds = [...new Set(input.assetIds)];
  return [
    { kind: "owner-collection", collection: "assets", ownerUserId: input.ownerUserId },
    {
      kind: "viewer-collection",
      collection: "assets",
      viewerUserId: input.ownerUserId,
    },
    ...assetIds.flatMap((assetId): AffectedScope[] => [
      {
        kind: "viewer-entity",
        entity: "asset",
        entityId: assetId,
        viewerUserId: input.ownerUserId,
      },
      { kind: "visible-entity", entity: "asset", entityId: assetId },
      { kind: "linked-entity", entity: "asset", entityId: assetId },
    ]),
    ...ownerSurfaceScopes(input.ownerUserId),
  ];
}

export function affectedScopesForGeneralActionIds(input: {
  ownerUserId: string;
  generalActionIds: readonly string[];
}): AffectedScope[] {
  const generalActionIds = [...new Set(input.generalActionIds)];
  return [
    {
      kind: "viewer-collection",
      collection: "general-actions",
      viewerUserId: input.ownerUserId,
    },
    ...generalActionIds.map(
      (generalActionId): AffectedScope => ({
        kind: "viewer-entity",
        entity: "general-action",
        entityId: generalActionId,
        viewerUserId: input.ownerUserId,
      }),
    ),
    { kind: "owner-collection", collection: "today", ownerUserId: input.ownerUserId },
    { kind: "owner-collection", collection: "review", ownerUserId: input.ownerUserId },
  ];
}

/**
 * What a Saved Item write invalidates.
 *
 * A household-native item has no owner, so it emits no owner-scoped anything:
 * no owner collection, no owner surfaces, no per-viewer entity keyed to a member
 * who does not own it. It reaches its readers through the household collection
 * and the visible-entity scope instead - which is the correct shape anyway, since
 * its audience is "every active member, including future ones" rather than a
 * list this function could enumerate.
 */
export function affectedScopesForSavedItem(item: {
  id: string;
  ownerUserId: string | null;
  householdId?: string | null;
  sharedWithUserIds?: readonly string[];
}): AffectedScope[] {
  const householdScopes = item.householdId
    ? ([
        {
          kind: "household-collection",
          collection: "saved-items",
          householdId: item.householdId,
        },
      ] satisfies AffectedScope[])
    : [];
  if (!item.ownerUserId) {
    return [
      { kind: "visible-entity", entity: "saved-item", entityId: item.id },
      ...householdScopes,
    ];
  }

  const ownerUserId = item.ownerUserId;
  const viewers = new Set([ownerUserId, ...(item.sharedWithUserIds ?? [])]);
  return [
    { kind: "owner-collection", collection: "saved-items", ownerUserId },
    ...[...viewers].map(
      (viewerUserId): AffectedScope => ({
        kind: "viewer-collection",
        collection: "saved-items",
        viewerUserId,
      }),
    ),
    {
      kind: "viewer-entity",
      entity: "saved-item",
      entityId: item.id,
      viewerUserId: ownerUserId,
    },
    { kind: "visible-entity", entity: "saved-item", entityId: item.id },
    ...householdScopes,
    ...ownerSurfaceScopes(ownerUserId),
  ];
}
