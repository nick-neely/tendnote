import type {
  AssetSearchCandidate,
  AssetSearchQueryPlan,
  ParsedSearchAssetsInput,
  SearchAssetsInput,
} from "@tendnote/domain";

export type AssetSearchQueryInput = ParsedSearchAssetsInput & {
  ownerUserId: string;
};

/**
 * The unparsed request shape for the Asset Search entry points: the raw
 * {@link SearchAssetsInput} plus the caller's owner id, with the schema filling
 * defaults (limit, includeArchived, includeReviewGated). Stores always receive the
 * parsed {@link AssetSearchQueryInput}, so defaults are resolved before any SQL runs.
 */
export type SearchAssetsRequest = SearchAssetsInput & {
  ownerUserId: string;
};

/** The lexical + structured tiers run against the records themselves. */
export type SearchAssetRecordsInput = AssetSearchQueryInput & {
  plan: AssetSearchQueryPlan;
};

/** The semantic tier runs against the shared embedding index. */
export type SearchAssetEmbeddingsInput = AssetSearchQueryInput & {
  queryEmbedding: number[];
  embeddingModel: string;
  embeddingVersion: string;
};

/**
 * The Asset Search persistence surface, split by *signal* rather than by table. Both
 * methods return candidates on one comparable scale so the pure fusion in the domain
 * can merge them without knowing where they came from.
 *
 * Both are responsible for visibility: every candidate a store returns must already
 * be one the caller may see. Scope filtering is deterministic and happens *inside*
 * the query — never as a post-filter — so a hidden child record can never reach the
 * fusion step at all.
 */
export type AssetSearchStore = {
  /**
   * Exact text and structured typed values, in one pass over Assets, Asset Memories,
   * and Asset Evidence. A record may match both ways; the store emits a candidate per
   * signal so the merge can report both.
   */
  searchAssetRecords: (input: SearchAssetRecordsInput) => Promise<AssetSearchCandidate[]>;
  /** Vector similarity for fuzzy intent, over embedded Assets and Asset Memories. */
  searchAssetEmbeddings: (input: SearchAssetEmbeddingsInput) => Promise<AssetSearchCandidate[]>;
};
