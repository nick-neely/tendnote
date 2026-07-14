import {
  type AssetSearchCandidate,
  type AssetSearchResult,
  mergeAssetSearchResults,
  parseAssetSearchQuery,
  searchAssetsSchema,
} from "@tendnote/domain";
import { DEFAULT_EMBEDDING_CONFIG } from "../semantic-retrieval/processor";
import type { EmbeddingAdapter, EmbeddingConfig } from "../semantic-retrieval/types";
import type { AssetSearchQueryInput, AssetSearchStore, SearchAssetsRequest } from "./types";

/**
 * Unified Asset Search (#204): one entry point, three signals underneath.
 *
 * The user never picks a mode. A single query is resolved into a deterministic plan
 * (identifiers, an amount, a date, alias-folded name tokens), the lexical/structured
 * tiers and the semantic tier are run in parallel, and the pure domain fusion merges
 * them into one ranked list of *grounded records* — never generated prose.
 *
 * The three tiers are deliberately not equal. Exact and structured recall are the
 * guarantee; the semantic tier is an enhancement layered on top. That asymmetry is
 * enforced in two places: the semantic tier fails *open* below (a cold index degrades
 * search to exact recall rather than breaking it), and the pure fusion gates
 * meaning-only records to the Assets the query actually found, so the weakest signal can
 * enhance an answer but never become the noise floor of one (`passesSemanticGate`).
 */
export function createAssetSearch(
  store: AssetSearchStore,
  adapter: EmbeddingAdapter,
  config: EmbeddingConfig = DEFAULT_EMBEDDING_CONFIG,
) {
  return {
    async searchAssets(input: SearchAssetsRequest): Promise<AssetSearchResult[]> {
      const parsed = searchAssetsSchema.parse(input);
      const query: AssetSearchQueryInput = { ...parsed, ownerUserId: input.ownerUserId };
      const plan = parseAssetSearchQuery(parsed.query);

      const [records, semantic] = await Promise.all([
        store.searchAssetRecords({ ...query, plan }),
        searchSemanticTier(store, adapter, config, query),
      ]);

      // Fusion, ranking, and the limit all live in the pure domain merge — so the
      // ranking a user sees is explainable and testable without a database.
      return mergeAssetSearchResults({
        candidates: [...records, ...semantic],
        limit: parsed.limit,
      });
    },
  };
}

/**
 * The semantic tier, failed open. Embedding a query needs a live adapter and a warm
 * index; neither is a correctness dependency for finding a serial number you typed
 * exactly. A missing gateway credential, a cold embedding, or an unmigrated column
 * degrades Asset Search to exact + structured recall rather than breaking the search
 * — the same fail-open posture the snapshot cache takes.
 */
async function searchSemanticTier(
  store: AssetSearchStore,
  adapter: EmbeddingAdapter,
  config: EmbeddingConfig,
  query: AssetSearchQueryInput,
): Promise<AssetSearchCandidate[]> {
  try {
    const embedded = await adapter.embedText({
      text: query.query,
      model: config.model,
      version: config.version,
    });

    return await store.searchAssetEmbeddings({
      ...query,
      queryEmbedding: embedded.vector,
      embeddingModel: embedded.model,
      embeddingVersion: embedded.version,
    });
  } catch {
    return [];
  }
}
