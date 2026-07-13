import {
  type AssetHistoryActionSource,
  type AssetHistoryEntry,
  composeAssetHistory,
  isDurableAssetStatus,
} from "@tendnote/domain";
import type { GeneralActionStore } from "../general-actions/types";
import type { ListAssetContextInput } from "./link-types";
import { loadAnchor } from "./review-shared";
import type { AssetReviewLifecycleStore } from "./review-types";

/**
 * Everything the user-facing Asset History read composes over (#202): the asset
 * review lifecycle store (asset + audit + memories + action-link rows) plus the
 * two General Action reads that keep action history authoritative on the action
 * side — the scope-visible load and its event trail. Reads-only: history never
 * writes anything.
 */
export type AssetHistoryStore = AssetReviewLifecycleStore &
  Pick<GeneralActionStore, "getVisibleGeneralAction" | "listGeneralActionEvents">;

/** A calm default cap — a story, not an infinite feed. */
const DEFAULT_HISTORY_LIMIT = 50;

/**
 * The user-facing Asset History for one asset (#202): derived at read time from
 * the asset's own lifecycle (audit-backed), the reviewed Asset Memories the
 * caller may see, and the lifecycle history of visible linked General Actions —
 * never a separate maintenance-log source of truth (#196). Every source is
 * filtered per record for this caller before composition, fail-closed: an
 * invisible asset reads as no history at all.
 */
async function listAssetHistory(
  store: AssetHistoryStore,
  input: ListAssetContextInput & { limit?: number },
): Promise<AssetHistoryEntry[]> {
  const asset = await loadAnchor(store, input.callerUserId, input.assetId);
  if (!asset || !isDurableAssetStatus(asset.status)) {
    return [];
  }

  // The asset's own lifecycle trail, keyed on the record's true owner — the
  // caller already passed the visibility gate above, mirroring the General
  // Action history read (ADR 0153).
  const [auditEvents, memories, links] = await Promise.all([
    store.listAssetAuditEvents({ ownerUserId: asset.ownerUserId, assetId: asset.id }),
    store.listVisibleAssetMemoriesForAsset({
      callerUserId: input.callerUserId,
      assetId: asset.id,
    }),
    store.listGeneralActionAssetLinksForAsset({ assetId: asset.id }),
  ]);

  // Linked actions surface only under their own scope rules; each visible one
  // contributes its authoritative lifecycle events (#196: one lifecycle source).
  const actionEntries: AssetHistoryActionSource[] = [];
  for (const link of links) {
    const action = await store.getVisibleGeneralAction({
      callerUserId: input.callerUserId,
      generalActionId: link.generalActionId,
    });
    if (!action) {
      continue;
    }
    const events = await store.listGeneralActionEvents({
      ownerUserId: action.ownerUserId,
      generalActionId: action.id,
    });
    actionEntries.push({ action: { id: action.id, title: action.title }, events });
  }

  return composeAssetHistory({
    auditEvents,
    memories,
    actions: actionEntries,
    limit: input.limit ?? DEFAULT_HISTORY_LIMIT,
  });
}

/** The Asset History seam (#202): one derived, read-only story per asset. */
export function createAssetHistory(store: AssetHistoryStore) {
  return {
    listAssetHistory: (input: ListAssetContextInput & { limit?: number }) =>
      listAssetHistory(store, input),
  };
}
