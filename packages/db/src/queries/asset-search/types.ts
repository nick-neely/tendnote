import type {
  AssetSearchCandidate,
  AssetSearchQueryPlan,
  AssetSearchResult,
  ParsedSearchAssetsInput,
  SearchAssetsInput,
} from "@tendnote/domain";
import type { HouseholdStore } from "../households/types";

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
 * The two household reads the Asset Search proof is built from. Both are keyed by
 * facts the caller cannot assert: their own memberships, and the record's stored
 * audience.
 */
export type AssetSearchAuthorityStore = Pick<
  HouseholdStore,
  "listActiveHouseholdMembershipsForUser" | "listHouseholdRecordSharesForRecords"
>;

/**
 * The Asset Search persistence surface, split by *signal* rather than by table. Both
 * methods return candidates on one comparable scale so the pure fusion in the domain
 * can merge them without knowing where they came from.
 *
 * Both are responsible for narrowing: every candidate a store returns must already
 * be one the caller could plausibly see. Scope filtering is deterministic and happens
 * *inside* the query — never as a post-filter — so a hidden child record does not
 * leave the database at all.
 *
 * That narrowing is `visibleHouseholdRecordSql`, and it is a pre-filter rather than
 * the decision. The decision is the Household Authorization Proof the seam obtains
 * for every surviving candidate before fusion (see `authority.ts`), which is why
 * each candidate carries its own `authorization` facts alongside what it displays.
 * The two gates answer the same question in the two languages it has to hold in,
 * and the proof is the ceiling: a row SQL admitted and the proof refuses is dropped
 * and leaves nothing behind (ADR 0219). #386 deferred this to #390, which closed it.
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
