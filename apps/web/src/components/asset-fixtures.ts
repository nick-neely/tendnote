import type { AssetView } from "@/lib/asset-view";

/**
 * A complete AssetView with calm defaults, overridable per test — the same
 * fixture idiom as `generalActionViewFixture`, so asset tests never re-spell the
 * whole view shape.
 */
export function assetViewFixture(overrides: Partial<AssetView> = {}): AssetView {
  return {
    id: "asset-1",
    name: "Refrigerator water filter",
    kind: "appliance",
    kindLabel: "Appliance",
    status: "active",
    archived: false,
    scope: "private",
    visibilityLabel: "Only me",
    owned: true,
    ownerUserId: "owner-1",
    addedLabel: "Added Jul 1",
    archivedLabel: null,
    needsReview: false,
    nextDueActionLabel: null,
    ...overrides,
  };
}
