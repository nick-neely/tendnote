import type { AssetSearchResult } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import {
  type AssetSearchResultView,
  isExactAssetSearchResult,
  toAssetSearchResultView,
} from "@/lib/asset-search-view";

/** A mapped view, for the grouping predicate the results list runs on. */
function view(overrides: Partial<AssetSearchResultView> = {}): AssetSearchResultView {
  const mapped = toAssetSearchResultView(result());
  if (!mapped) {
    throw new Error("Expected a browsable result.");
  }
  return { ...mapped, ...overrides };
}

function result(overrides: Partial<AssetSearchResult> = {}): AssetSearchResult {
  return {
    recordKind: "asset_memory",
    recordId: "memory-1",
    assetId: "asset-1",
    assetName: "Refrigerator",
    assetKind: "appliance",
    assetStatus: "active",
    ownership: "member_owned",
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

  it("reads an amount and a date the way the Asset Profile reads them", () => {
    // The same fact may not have two spellings in one product: a search result and the
    // Memories section it links to must agree. `describeAssetMemoryValue` stays the
    // canonical *machine* projection (snapshot prose, embedded text); the view speaks
    // to a person.
    expect(
      toAssetSearchResultView(
        result({ value: { type: "amount", amount: 1299.99, currency: "USD" } }),
      )?.value,
    ).toBe("$1,299.99");
    expect(
      toAssetSearchResultView(result({ value: { type: "date", date: "2027-01-04" } }))?.value,
    ).toBe("Jan 4, 2027");
  });

  it("carries the anchor's ownership, so the row knows whether an audience was chosen", () => {
    // A household-native record has no audience anyone chose; without this the row would
    // state one, and "Whole household" would read as a sharing decision (ADR 0214).
    expect(toAssetSearchResultView(result({ ownership: "household_native" }))?.ownership).toBe(
      "household_native",
    );
    expect(toAssetSearchResultView(result())?.ownership).toBe("member_owned");
  });

  it("separates exact and structured hits from meaning-only ones", () => {
    // What the results list groups on: "the stored value *is* what you typed" and "this
    // seemed related" are different claims and must not read as one list.
    expect(isExactAssetSearchResult(view({ matchKinds: ["structured"] }))).toBe(true);
    expect(isExactAssetSearchResult(view({ matchKinds: ["exact"] }))).toBe(true);
    expect(isExactAssetSearchResult(view({ matchKinds: ["exact", "semantic"] }))).toBe(true);
    expect(isExactAssetSearchResult(view({ matchKinds: ["semantic"] }))).toBe(false);
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
