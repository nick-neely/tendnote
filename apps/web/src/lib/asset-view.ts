import type {
  AssetBrowseRow,
  AssetBrowseSort,
  AssetDueFilter,
  AssetReviewFilter,
  AssetWithContext,
} from "@tendnote/db/queries/assets";
import type { AssetKind, AssetStatus, PrivacyScope, RecordSurfacingState } from "@tendnote/domain";
import { assetLabelForKind } from "@tendnote/domain";
import {
  formatSurfacingDay,
  resolveRecordContext,
  resolveRecordTiming,
} from "@tendnote/domain/record-surfacing";
import type { OwnerActionResult } from "@/lib/owner-action";

/**
 * Result of an Asset mutation server action. Validation failures (a blank name,
 * an invalid transition) return `{ ok: false, error }` with a curated, user-safe
 * message so the surface can show it inline; unexpected/infra failures reject and
 * the client shows a generic fallback — mirroring the General Action result union.
 */
export type AssetMutationResult = OwnerActionResult<AssetView>;

export type AssetBrowseRequest = {
  kind: AssetKind | null;
  state: "active" | "archived" | "all";
  scope: PrivacyScope | null;
  due: AssetDueFilter | null;
  review: AssetReviewFilter | null;
  sort: AssetBrowseSort;
  offset?: number;
};

export type AssetBrowsePageView = {
  assets: AssetView[];
  reviewCount: number;
  nextOffset: number | null;
};

export type AssetBrowseRunner = (input: AssetBrowseRequest) => Promise<AssetBrowsePageView>;

export type AssetView = {
  id: string;
  revision: string;
  name: string;
  kind: AssetKind;
  /** The canonical kind label ("Appliance"), shared with pickers and chips. */
  kindLabel: string;
  status: AssetStatus;
  /** Whether the asset is archived — quiet history, never an urgent state. */
  archived: boolean;
  /** Visibility scope (ADR 0153). Drives the calm scope chip; private stays bare. */
  scope: PrivacyScope;
  /**
   * A calm scope label that says *who*, not just that it's shared — "Only me",
   * "Specific people · 2", or the household's name. Mirrors the General Action
   * audience label so scope reads the same across surfaces.
   */
  visibilityLabel: string;
  /** Whether the viewing user owns this asset. Only the owner may rename it. */
  owned: boolean;
  ownerUserId: string;
  /** A calm provenance line, e.g. "Added Jul 1". */
  addedLabel: string;
  /** "Archived Jul 10" when archived, otherwise null. */
  archivedLabel: string | null;
  /** An unresolved Asset Review Group is anchored to this durable asset. */
  needsReview?: boolean;
  /** Calm display label for the soonest visible linked action with a due date. */
  nextDueActionLabel?: string | null;
  nextDueActionState?: RecordSurfacingState | null;
};

/** Maps a hydrated Asset to the flat view the Assets surface and profile render. */
export function toAssetView(
  asset: AssetWithContext,
  options: { callerUserId: string; now?: Date },
): AssetView {
  const now = options.now ?? new Date();
  const surfacing = resolveRecordContext({
    ownerUserId: asset.ownerUserId,
    viewerUserId: options.callerUserId,
    scope: asset.scope,
    sharedWithCount: asset.sharedWithCount,
    householdName: asset.householdName,
    updatedAt: asset.updatedAt,
  });
  return {
    id: asset.id,
    revision: surfacing.revision,
    name: asset.name,
    kind: asset.kind,
    kindLabel: assetLabelForKind(asset.kind),
    status: asset.status,
    archived: asset.status === "archived",
    scope: asset.scope,
    visibilityLabel: surfacing.audienceLabel,
    owned: surfacing.owned,
    ownerUserId: asset.ownerUserId,
    addedLabel: `Added ${formatSurfacingDay(asset.createdAt, now)}`,
    archivedLabel: asset.archivedAt
      ? `Archived ${formatSurfacingDay(asset.archivedAt, now)}`
      : null,
  };
}

/** Maps one enriched browse row while keeping date copy consistent across pages. */
export function toAssetBrowseView(
  row: AssetBrowseRow & { asset: AssetWithContext },
  options: { callerUserId: string; now?: Date },
): AssetView {
  const now = options.now ?? new Date();
  const timing = row.nextDueAction
    ? resolveRecordTiming({ kind: "general_action", ...row.nextDueAction }, now)
    : null;
  return {
    ...toAssetView(row.asset, { ...options, now }),
    needsReview: row.needsReview,
    nextDueActionLabel: timing?.timingLabel ?? null,
    nextDueActionState: timing?.state ?? null,
  };
}
