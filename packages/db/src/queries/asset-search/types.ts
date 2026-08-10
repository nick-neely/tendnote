import type {
  AssetSearchCandidate,
  AssetSearchQueryPlan,
  AssetSearchResult,
  ParsedSearchAssetsInput,
  SearchAssetsInput,
} from "@tendnote/domain";

export type AssetSearchOutcome = {
  results: AssetSearchResult[];
  semanticAvailable: boolean;
};

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
 *
 * ## Residual: Asset Search is pre-filtered, not proved (#386 → #390)
 *
 * That filtering is `visibleHouseholdRecordSql`, which is a *pre-filter* and not
 * a Household Authorization Proof (ADR 0219). #386 ceilinged every other Asset
 * read with the proof — the ledger, the profile's memories and evidence, the
 * gated bytes route — and deliberately stopped here. Two reasons, both cost
 * rather than principle:
 *
 * - The proof needs a record's `ownerUserId`, `scope`, `householdId`, and
 *   `ownership`, and `AssetSearchCandidate` carries none of them. Adding them
 *   widens a shape that reaches the drizzle store, its in-memory twin, Eve, and
 *   Global Recall — a blast radius well outside #386's acceptance criteria.
 * - Search is a live per-request query, so the predicate is evaluated *now*. The
 *   staleness window the proof closes elsewhere — a cached ledger page, a
 *   deep-linked url, a queued job — does not exist on this path. That makes the
 *   gap narrower here than anywhere else, not absent: sensitivity, domain
 *   exclusions, and record lifecycle are facts SQL still cannot see.
 *
 * #390 owns closing it. This note exists because the defect was the silence, not
 * the deferral: a seam pre-filtered where its siblings are proved has to say so
 * where whoever extends it will read it.
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
