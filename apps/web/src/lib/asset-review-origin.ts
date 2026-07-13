import type { AssetReviewGroupResult } from "@tendnote/db/queries/assets";
import { getPromotedFromGeneralAction } from "@tendnote/db/queries/assets";
import { type AssetReviewGroupView, toAssetReviewGroupView } from "@/lib/asset-review-view";

/**
 * Maps an Asset Review Group result to its card view with the promoted-from
 * action resolved (#199), so a hint promotion is grounded on the card even when
 * it carries no source record. Server-side only (it reads the db seam) — the
 * one view builder every review surface and mutation shares, so the origin line
 * never disappears after a card interaction. Origin is resolved only while the
 * anchor is still pending: it is precise there (a suggested anchor exists only
 * because of one promotion), and a resolved group leaves the queue anyway.
 */
export async function toAssetReviewGroupViewWithOrigin(
  result: AssetReviewGroupResult,
): Promise<AssetReviewGroupView> {
  const fromAction = result.assetPending
    ? await getPromotedFromGeneralAction({
        ownerUserId: result.group.ownerUserId,
        assetId: result.group.assetId,
      })
    : null;
  return toAssetReviewGroupView(result, { fromAction });
}
