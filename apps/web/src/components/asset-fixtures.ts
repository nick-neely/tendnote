import { type AssetView, resolveAssetAuthority } from "@/lib/asset-view";

/**
 * A complete AssetView with calm defaults, overridable per test — the same
 * fixture idiom as `generalActionViewFixture`, so asset tests never re-spell the
 * whole view shape.
 */
export function assetViewFixture(overrides: Partial<AssetView> = {}): AssetView {
  const ownership = overrides.ownership ?? "member_owned";
  const owned = overrides.owned ?? true;
  return {
    id: "asset-1",
    revision: "2026-07-01T12:00:00.000Z",
    contentRevision: 0,
    name: "Refrigerator water filter",
    kind: "appliance",
    kindLabel: "Appliance",
    status: "active",
    archived: false,
    scope: "private",
    visibilityLabel: "Only me",
    owned,
    ownerUserId: "owner-1",
    ownership,
    viewerUserId: "owner-1",
    // Derived rather than hard-coded so a fixture can never assert an authority
    // the real projection would not grant.
    authority: resolveAssetAuthority(ownership, owned),
    createdByUserId: "owner-1",
    lastActorUserId: "owner-1",
    addedLabel: "Added Jul 1",
    archivedLabel: null,
    needsReview: false,
    nextDueActionLabel: null,
    nextDueActionState: null,
    ...overrides,
  };
}
