import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listAssetEvidence,
  listAssetMemories,
  listAssetPersonLinks,
  listAssetReviewGroups,
  listLinkedGeneralActionsForAsset,
  listRelatedAssetLinks,
} = vi.hoisted(() => ({
  listAssetEvidence: vi.fn(),
  listAssetMemories: vi.fn(),
  listAssetPersonLinks: vi.fn(),
  listAssetReviewGroups: vi.fn(),
  listLinkedGeneralActionsForAsset: vi.fn(),
  listRelatedAssetLinks: vi.fn(),
}));

// `server-only` throws outside an RSC bundle; stub it so the page loads in tests.
vi.mock("server-only", () => ({}));
vi.mock("@tendnote/db/queries/assets", () => ({
  getAsset: vi.fn(),
  listAssetEvidence,
  listAssetHistory: vi.fn(),
  listAssetMemories,
  listAssetPersonLinks,
  listAssetReviewGroups,
  listAssets: vi.fn(),
  listLinkedGeneralActionsForAsset,
  listPendingAssetActionProposals: vi.fn(),
  listRelatedAssetLinks,
}));
vi.mock("@tendnote/db/queries/asset-snapshots", () => ({ getAssetSnapshot: vi.fn() }));
vi.mock("@tendnote/db/queries/households", () => ({
  listShareableHouseholdMembersForUser: vi.fn(),
}));
vi.mock("@tendnote/db/queries/people", () => ({ searchPeople: vi.fn() }));
vi.mock("@/lib/access/current-access", () => ({
  requireAdmittedOwner: vi.fn(),
  requireAdmittedOwnerForAction: vi.fn(),
}));
vi.mock("@/lib/cache/asset-views", () => ({ getCachedAssetCoreView: vi.fn() }));

import { AssetRemoveStream, loadAssetReviewItemCount, loadAssetTabCounts } from "./page";

const request = { assetId: "asset-1", callerUserId: "owner-1" };

/** Every count read lands, with something behind each of them. */
function countsAreReadable() {
  listAssetMemories.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);
  listAssetEvidence.mockResolvedValue([{ id: "e1" }]);
  listLinkedGeneralActionsForAsset.mockResolvedValue([{ id: "a1" }, { id: "a2" }, { id: "a3" }]);
  listRelatedAssetLinks.mockResolvedValue([{ id: "l1" }]);
  listAssetPersonLinks.mockResolvedValue([{ id: "p1" }, { id: "p2" }]);
  listAssetReviewGroups.mockResolvedValue([
    { asset: { id: "asset-1" }, assetPending: true, memories: [{ id: "m1" }] },
    { asset: { id: "asset-2" }, assetPending: true, memories: [{ id: "m9" }] },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  countsAreReadable();
});

/**
 * The delete-confirmation gate. `AssetRemove` waives its type-to-confirm phrase
 * only for an asset with genuinely nothing saved in it, so every read feeding
 * that decision has to report a failure as unknown rather than as zero. Folding
 * the two together is what turned permanent deletion of a full asset into one
 * click, and these pin the seam that keeps them apart.
 */
describe("Asset profile delete-confirmation counts", () => {
  it("reports unreadable counts as unknown, never as an empty asset", async () => {
    listAssetMemories.mockRejectedValue(new Error("count store unavailable"));

    await expect(loadAssetTabCounts(request)).resolves.toBeNull();
  });

  it("reports an unreadable review queue as unknown, never as nothing pending", async () => {
    listAssetReviewGroups.mockRejectedValue(new Error("review queue unavailable"));

    await expect(loadAssetReviewItemCount(request)).resolves.toBeNull();
  });

  it("keeps the type-to-confirm gate when the counts cannot be read", async () => {
    listAssetEvidence.mockRejectedValue(new Error("count store unavailable"));

    const element = await AssetRemoveStream({
      assetName: "Kitchen refrigerator",
      counts: loadAssetTabCounts(request),
      request,
      reviewItems: loadAssetReviewItemCount(request),
    });

    // Null summary is what holds the gate up: see the AssetRemove dom test.
    expect(element.props.summary).toBeNull();
  });

  it("keeps the gate when only the review queue cannot be read", async () => {
    listAssetReviewGroups.mockRejectedValue(new Error("review queue unavailable"));

    const element = await AssetRemoveStream({
      assetName: "Kitchen refrigerator",
      counts: loadAssetTabCounts(request),
      request,
      reviewItems: loadAssetReviewItemCount(request),
    });

    expect(element.props.summary).toBeNull();
  });

  it("summarizes exactly what will go when every read lands", async () => {
    const element = await AssetRemoveStream({
      assetName: "Kitchen refrigerator",
      counts: loadAssetTabCounts(request),
      request,
      reviewItems: loadAssetReviewItemCount(request),
    });

    expect(element.props.summary).toEqual({
      memories: 2,
      evidence: 1,
      reviewItems: 2,
      linkedRecords: 3,
    });
  });
});
