import type { AssetSearchResult } from "@tendnote/domain";
import { describeAssetMemoryValue } from "@tendnote/domain";

/**
 * One Asset Search result, flattened for rendering. The exact stored value is lifted
 * into its own field because it is what the user actually came for — a filter size, a
 * serial, a price — and the row should let them read it without parsing a sentence.
 *
 * `matchKinds` is carried through deliberately: a unified search that fuses three
 * signals owes the user an explanation of *why* a row is here. "Exact value" and
 * "Related" are very different claims, and hiding the difference would make the search
 * feel like a guess.
 */
/**
 * The trust registers that can actually appear on the Assets surface. A *suggested* Asset
 * Memory is excluded by construction: the surface never asks for review context, so an
 * un-reviewed proposal cannot reach it. Review belongs in the Review Queue, not in search.
 */
export type BrowsableAssetTrustLevel = Exclude<
  AssetSearchResult["trustLevel"],
  "suggested_asset_fact"
>;

export type AssetSearchResultView = {
  key: string;
  recordKind: AssetSearchResult["recordKind"];
  recordId: string;
  assetId: string;
  assetName: string;
  assetKind: AssetSearchResult["assetKind"];
  archived: boolean;
  label: string;
  snippet: string;
  value: string | null;
  matchKinds: AssetSearchResult["matchKinds"];
  trustLevel: BrowsableAssetTrustLevel;
  visibilityLabel: string;
};

/**
 * Maps one grounded result for the Assets surface, or `null` for a suggested memory.
 *
 * The seam already cannot return one here (the action never opens the review gate), so
 * this branch is unreachable — and it is written as a *refusal* rather than a label, so
 * that if a future caller ever does open the gate, an un-reviewed proposal is dropped from
 * the browsable surface instead of quietly rendering beside confirmed facts.
 */
export function toAssetSearchResultView(result: AssetSearchResult): AssetSearchResultView | null {
  if (result.trustLevel === "suggested_asset_fact") {
    return null;
  }

  return {
    key: `${result.recordKind}:${result.recordId}`,
    recordKind: result.recordKind,
    recordId: result.recordId,
    assetId: result.assetId,
    assetName: result.assetName,
    assetKind: result.assetKind,
    archived: result.assetStatus === "archived",
    label: result.label,
    snippet: result.snippet,
    value: describeAssetMemoryValue(result.value) || null,
    matchKinds: result.matchKinds,
    trustLevel: result.trustLevel,
    visibilityLabel: result.visibilityLabel,
  };
}

/** What each signal means, in the user's words rather than the engine's. */
export const ASSET_MATCH_KIND_LABEL: Record<AssetSearchResult["matchKinds"][number], string> = {
  structured: "Exact value",
  exact: "Exact text",
  semantic: "Related",
};

/** The trust register of a browsable result, said plainly. */
export const ASSET_TRUST_LABEL: Record<BrowsableAssetTrustLevel, string> = {
  asset_fact: "Confirmed fact",
  asset_anchor: "Asset",
  asset_evidence: "Evidence on file",
};
