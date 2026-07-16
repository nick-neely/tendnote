import type {
  AssetBrowseRow,
  AssetBrowseSort,
  AssetDueFilter,
  AssetReviewFilter,
  AssetWithContext,
} from "@tendnote/db/queries/assets";
import type { AssetKind, AssetStatus, PrivacyScope } from "@tendnote/domain";
import { assetLabelForKind } from "@tendnote/domain";
import { visibilityLabelForScope } from "@tendnote/domain/privacy";

/**
 * Result of an Asset mutation server action. Validation failures (a blank name,
 * an invalid transition) return `{ ok: false, error }` with a curated, user-safe
 * message so the surface can show it inline; unexpected/infra failures reject and
 * the client shows a generic fallback — mirroring the General Action result union.
 */
export type AssetMutationResult = { ok: true; view: AssetView } | { ok: false; error: string };

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
};

function formatDay(date: Date, now: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/**
 * The audience label for the calm visibility chip — a member count for a
 * selected-shared asset, the household's name for a household one (both falling
 * back to the plain scope label). Mirrors the General Action view's audience
 * resolution so scope language never forks between surfaces.
 */
function scopeAudienceLabel(asset: {
  scope: PrivacyScope;
  sharedWithCount: number;
  householdName: string | null;
}): string {
  if (asset.scope === "shared") {
    const base = visibilityLabelForScope("shared");
    return asset.sharedWithCount > 0 ? `${base} · ${asset.sharedWithCount}` : base;
  }
  if (asset.scope === "household") {
    return asset.householdName ?? visibilityLabelForScope("household");
  }
  return visibilityLabelForScope("private");
}

/** Maps a hydrated Asset to the flat view the Assets surface and profile render. */
export function toAssetView(
  asset: AssetWithContext,
  options: { callerUserId: string; now?: Date },
): AssetView {
  const now = options.now ?? new Date();
  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    kindLabel: assetLabelForKind(asset.kind),
    status: asset.status,
    archived: asset.status === "archived",
    scope: asset.scope,
    visibilityLabel: scopeAudienceLabel(asset),
    owned: asset.ownerUserId === options.callerUserId,
    ownerUserId: asset.ownerUserId,
    addedLabel: `Added ${formatDay(asset.createdAt, now)}`,
    archivedLabel: asset.archivedAt ? `Archived ${formatDay(asset.archivedAt, now)}` : null,
  };
}

/** Maps one enriched browse row while keeping date copy consistent across pages. */
export function toAssetBrowseView(
  row: AssetBrowseRow & { asset: AssetWithContext },
  options: { callerUserId: string; now?: Date },
): AssetView {
  const now = options.now ?? new Date();
  return {
    ...toAssetView(row.asset, { ...options, now }),
    needsReview: row.needsReview,
    nextDueActionLabel: row.nextDueActionAt
      ? `Next action ${formatDay(row.nextDueActionAt, now)}`
      : null,
  };
}
