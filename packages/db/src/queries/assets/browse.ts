import type { AssetBrowsePage, AssetBrowseStore, BrowseAssetsInput } from "./browse-types";

const DEFAULT_ASSET_PAGE_SIZE = 24;
const MAX_ASSET_PAGE_SIZE = 50;

/**
 * Bounded Asset ledger browsing. The adapter owns visibility, metadata joins,
 * filtering, and ordering; callers receive one ready-to-render page and never
 * need to understand the Review Queue or General Action link tables.
 */
export function createAssetBrowser(store: AssetBrowseStore) {
  return {
    async browseAssets(input: BrowseAssetsInput): Promise<AssetBrowsePage> {
      const pageSize = Math.min(
        MAX_ASSET_PAGE_SIZE,
        Math.max(1, input.pageSize ?? DEFAULT_ASSET_PAGE_SIZE),
      );
      const offset = Math.max(0, input.offset ?? 0);
      const [rows, reviewCount] = await Promise.all([
        store.listAssetBrowseRows({
          callerUserId: input.callerUserId,
          kinds: input.kinds,
          statuses: input.statuses,
          scopes: input.scopes,
          due: input.due,
          review: input.review,
          sort: input.sort ?? "name",
          limit: pageSize + 1,
          offset,
        }),
        store.countPendingAssetReviews({ ownerUserId: input.callerUserId }),
      ]);
      const hasMore = rows.length > pageSize;
      return {
        items: rows.slice(0, pageSize),
        reviewCount,
        nextOffset: hasMore ? offset + pageSize : null,
      };
    },
  };
}
