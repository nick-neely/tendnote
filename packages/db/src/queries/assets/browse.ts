import type { AssetBrowsePage, AssetBrowseStore, BrowseAssetsInput } from "./browse-types";
import { createAssetAuthority } from "./household-authority";
import type { AssetAuthorityStore } from "./types";

const DEFAULT_ASSET_PAGE_SIZE = 24;
const MAX_ASSET_PAGE_SIZE = 50;

/**
 * Bounded Asset ledger browsing. The adapter owns visibility, metadata joins,
 * filtering, and ordering; callers receive one ready-to-render page and never
 * need to understand the Review Queue or General Action link tables.
 *
 * The adapter's visibility is a SQL pre-filter, so the page is proved again here
 * against memberships read now — the ledger is the surface a departed member is
 * most likely to still have open, and a cached page is exactly what ADR 0219
 * says a proof may not be inherited from.
 */
export function createAssetBrowser(store: AssetBrowseStore & AssetAuthorityStore) {
  const { keepProvenAssets } = createAssetAuthority(store);

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
      // Paging arithmetic stays on the rows the query returned, not the ones the
      // proof kept: a refused row still occupied a place in the ordering, and
      // shifting the offset to close the gap would make the next page skip a
      // record. A short page is the correct shape — a refusal leaves nothing
      // behind, including a hole the caller could count.
      const items = await keepProvenAssets({
        callerUserId: input.callerUserId,
        rows: rows.slice(0, pageSize),
      });
      return {
        items,
        reviewCount,
        nextOffset: hasMore ? offset + pageSize : null,
      };
    },
  };
}
