import type { AssetSearchResult } from "@tendnote/domain";
import { formatAssetMemoryValue } from "@/lib/asset-memory-value";

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
    // The *view* projection, not the machine one. `describeAssetMemoryValue` is the
    // canonical text a snapshot or an embedding is built from ("2026-08-28", "47.99
    // USD") and must stay that way; a person reading a search result should see the
    // same "Aug 28, 2026" and "$47.99" the Memories section shows them one click later.
    // One fact cannot have two spellings across two surfaces of the same product.
    value: formatAssetMemoryValue(result.value),
    matchKinds: result.matchKinds,
    trustLevel: result.trustLevel,
    visibilityLabel: result.visibilityLabel,
  };
}

/**
 * Whether a result was found by an *exact* signal — the record literally contains what
 * the user typed, or its stored value literally is it — as opposed to by meaning alone.
 *
 * This is the search's most valuable claim, and grouping is how the results surface it:
 * "the filter *is* RPWFE" and "this seemed related to what you meant" are different
 * kinds of statement, and a trust register that renders them as one undifferentiated
 * list is asking the user to take both on faith.
 */
export function isExactAssetSearchResult(result: AssetSearchResultView): boolean {
  return result.matchKinds.some((kind) => kind === "structured" || kind === "exact");
}

/** The trust register of a browsable result, said plainly. */
export const ASSET_TRUST_LABEL: Record<BrowsableAssetTrustLevel, string> = {
  asset_fact: "Confirmed fact",
  asset_anchor: "Asset",
  asset_evidence: "Evidence on file",
};
