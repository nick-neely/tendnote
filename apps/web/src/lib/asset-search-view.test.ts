import type { AssetSearchResult } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { toAssetSearchResultView } from "@/lib/asset-search-view";

function result(overrides: Partial<AssetSearchResult> = {}): AssetSearchResult {
  return {
    recordKind: "asset_memory",
    recordId: "memory-1",
    assetId: "asset-1",
    assetName: "Refrigerator",
    assetKind: "appliance",
    assetStatus: "active",
    label: "Filter size",
    snippet: "Filter size: RPWFE",
    matchedFields: ["value"],
    matchKinds: ["structured"],
    score: 1,
    value: { type: "text", text: "RPWFE" },
    trustLevel: "asset_fact",
    visibilityChoice: "whole_household",
    visibilityLabel: "Whole household",
    citations: [{ kind: "asset_memory", id: "memory-1" }],
    ...overrides,
  };
}

describe("toAssetSearchResultView", () => {
  it("lifts the exact stored value out, so the answer can be read without parsing prose", () => {
    expect(toAssetSearchResultView(result())?.value).toBe("RPWFE");
  });

  it("renders an amount and a date exactly as stored", () => {
    expect(
      toAssetSearchResultView(result({ value: { type: "amount", amount: 1299.99, currency: "USD" } }))
        ?.value,
    ).toBe("1299.99 USD");
    expect(
      toAssetSearchResultView(result({ value: { type: "date", date: "2027-01-04" } }))?.value,
    ).toBe("2027-01-04");
  });

  it("refuses a suggested memory rather than labeling one", () => {
    // Unreachable today (the Assets surface never opens the review gate), and written as
    // a refusal so that if a caller ever does, an un-reviewed proposal is dropped from the
    // browsable surface instead of rendering beside confirmed facts.
    expect(toAssetSearchResultView(result({ trustLevel: "suggested_asset_fact" }))).toBeNull();
  });

  it("keeps a confirmed fact, an anchor, and evidence", () => {
    expect(toAssetSearchResultView(result({ trustLevel: "asset_fact" }))).not.toBeNull();
    expect(toAssetSearchResultView(result({ trustLevel: "asset_anchor" }))).not.toBeNull();
    expect(toAssetSearchResultView(result({ trustLevel: "asset_evidence" }))).not.toBeNull();
  });
});
