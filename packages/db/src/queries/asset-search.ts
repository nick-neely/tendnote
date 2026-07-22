import { createDrizzleAssetSearchStore } from "./asset-search/drizzle-store";
import { createAssetSearch } from "./asset-search/queries";
import type { SearchAssetsRequest } from "./asset-search/types";
import {
  createDefaultSemanticEmbeddingAdapter,
  createDefaultSemanticEmbeddingConfig,
} from "./semantic-retrieval";

export { createDrizzleAssetSearchStore } from "./asset-search/drizzle-store";
export type { AssetSearchSeed, SeededAssetEmbedding } from "./asset-search/in-memory-store";
export { createInMemoryAssetSearchStore } from "./asset-search/in-memory-store";
export { createAssetSearch } from "./asset-search/queries";
export type * from "./asset-search/types";

const defaultAssetSearch = createAssetSearch(
  createDrizzleAssetSearchStore(),
  createDefaultSemanticEmbeddingAdapter(),
  createDefaultSemanticEmbeddingConfig(),
);

/**
 * Unified Asset Search: exact text, structured typed values, and fuzzy intent, fused
 * into one ranked list of grounded, scope-filtered records (#204). Web and Eve both
 * call this seam rather than assembling search themselves.
 */
export async function searchAssets(input: SearchAssetsRequest) {
  return defaultAssetSearch.searchAssets(input);
}

/** Global Recall needs to distinguish an empty semantic tier from a failed one. */
export async function searchAssetsWithStatus(input: SearchAssetsRequest) {
  return defaultAssetSearch.searchAssetsWithStatus(input);
}
