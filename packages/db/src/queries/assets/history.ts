import {
  type AssetHistoryActionSource,
  type AssetHistoryEntry,
  composeAssetHistory,
  isDurableAssetStatus,
} from "@tendnote/domain";
import type { GeneralActionStore } from "../general-actions/types";
import type { AssetContextLinkStore, ListAssetContextInput } from "./link-types";
import { listAssetPersonLinks, listRelatedAssetLinks } from "./links";
import { loadAnchor } from "./review-shared";

/**
 * Everything the user-facing Asset History read composes over (#202): the
 * profile-context link store (asset + audit + memories + evidence + action-link
 * rows + the two context link kinds) plus the two General Action reads that keep
 * action history authoritative on the action side — the scope-visible load and
 * its event trail. Reads-only: history never writes anything.
 */
export type AssetHistoryStore = AssetContextLinkStore &
  Pick<GeneralActionStore, "getVisibleGeneralAction" | "listGeneralActionEvents">;

/** A calm default cap — a story, not an infinite feed. */
const DEFAULT_HISTORY_LIMIT = 50;

/**
 * The linked actions this caller may see, each with its authoritative lifecycle
 * events — General Action lifecycle stays the one source for action history
 * (#196), so history borrows it rather than keeping its own.
 */
async function loadVisibleActionHistory(
  store: AssetHistoryStore,
  input: ListAssetContextInput,
  assetId: string,
): Promise<AssetHistoryActionSource[]> {
  const links = await store.listGeneralActionAssetLinksForAsset({ assetId });
  const entries: AssetHistoryActionSource[] = [];
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
    entries.push({ action: { id: action.id, title: action.title }, events });
  }
  return entries;
}

/**
 * The user-facing Asset History for one asset (#202): derived at read time from
 * the asset's own lifecycle (audit-backed) and the records the caller may see —
 * reviewed memories, captured evidence, confirmed context links, and the
 * lifecycle history of visible linked General Actions. Never a separate
 * maintenance-log source of truth (#196).
 *
 * Every source is the *same read the profile renders*, filtered per record for
 * this caller before composition, fail-closed: an invisible asset reads as no
 * history at all, and history can never claim a moment the profile itself does
 * not show. Pending suggested links are excluded — a suggestion awaiting review
 * has not happened yet.
 */
async function listAssetHistory(
  store: AssetHistoryStore,
  input: ListAssetContextInput & { limit?: number },
): Promise<AssetHistoryEntry[]> {
  const asset = await loadAnchor(store, input.callerUserId, input.assetId);
  if (!asset || !isDurableAssetStatus(asset.status)) {
    return [];
  }

  // The asset's own lifecycle trail is keyed on the record's true owner — the
  // caller already passed the visibility gate above, mirroring the General
  // Action history read (ADR 0153). Everything else is a caller-scoped read.
  const [auditEvents, memories, evidence, assetLinks, personLinks, actions] = await Promise.all([
    store.listAssetAuditEvents({ ownerUserId: asset.ownerUserId, assetId: asset.id }),
    store.listVisibleAssetMemoriesForAsset({
      callerUserId: input.callerUserId,
      assetId: asset.id,
    }),
    store.listVisibleAssetEvidenceForAsset({
      callerUserId: input.callerUserId,
      assetId: asset.id,
    }),
    listRelatedAssetLinks(store, { callerUserId: input.callerUserId, assetId: asset.id }),
    listAssetPersonLinks(store, { callerUserId: input.callerUserId, assetId: asset.id }),
    loadVisibleActionHistory(store, input, asset.id),
  ]);

  return composeAssetHistory({
    auditEvents,
    memories,
    evidence,
    assetLinks: assetLinks.filter((link) => !link.pending),
    personLinks,
    actions,
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
