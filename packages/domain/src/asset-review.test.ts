import { describe, expect, it } from "vitest";
import {
  assetReviewGroupSchema,
  createAssetReviewGroupSchema,
  findAssetDuplicateCandidates,
} from "./asset-review";

describe("asset review group schema", () => {
  it("round-trips a persisted group", () => {
    const group = assetReviewGroupSchema.parse({
      id: "group-1",
      ownerUserId: "user-1",
      assetId: "asset-1",
      sourceRecordId: "source-1",
      createdAt: new Date(),
    });
    expect(group.assetId).toBe("asset-1");
  });

  it("defaults the source reference to null for creation", () => {
    const group = createAssetReviewGroupSchema.parse({
      ownerUserId: "user-1",
      assetId: "asset-1",
    });
    expect(group.sourceRecordId).toBeNull();
  });
});

type Candidate = { id: string; name: string; kind: string };

const EXISTING: Candidate[] = [
  { id: "a1", name: "Refrigerator water filter", kind: "appliance" },
  { id: "a2", name: "Toyota Corolla", kind: "vehicle" },
  { id: "a3", name: "Netflix", kind: "subscription" },
  { id: "a4", name: "Water heater", kind: "appliance" },
];

describe("duplicate matching (#198)", () => {
  it("matches the classic near-duplicate: fridge filter vs refrigerator water filter", () => {
    const candidates = findAssetDuplicateCandidates({ name: "fridge filter", assets: EXISTING });
    expect(candidates.map((asset) => asset.id)).toEqual(["a1"]);
  });

  it("matches regardless of case, punctuation, and simple plurals", () => {
    const candidates = findAssetDuplicateCandidates({
      name: "Refrigerator Water Filters!",
      assets: EXISTING,
    });
    expect(candidates.map((asset) => asset.id)).toContain("a1");
  });

  it("does not flag unrelated assets sharing a weak token", () => {
    // "Water heater" shares only "water" with the filter — not a duplicate.
    const candidates = findAssetDuplicateCandidates({ name: "Water heater", assets: EXISTING });
    expect(candidates.map((asset) => asset.id)).toEqual(["a4"]);
  });

  it("excludes a given asset id (the proposal's own row)", () => {
    const candidates = findAssetDuplicateCandidates({
      name: "Refrigerator water filter",
      assets: EXISTING,
      excludeAssetId: "a1",
    });
    expect(candidates).toEqual([]);
  });

  it("returns nothing for a name with no meaningful tokens", () => {
    expect(findAssetDuplicateCandidates({ name: "the ....", assets: EXISTING })).toEqual([]);
  });

  it("caps the candidate list", () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      id: `m${index}`,
      name: `Water filter ${index}`,
      kind: "item",
    }));
    const candidates = findAssetDuplicateCandidates({ name: "water filter", assets: many });
    expect(candidates.length).toBeLessThanOrEqual(3);
  });
});
