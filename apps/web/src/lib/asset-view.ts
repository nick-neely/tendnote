import type {
  AssetBrowseRow,
  AssetBrowseSort,
  AssetDueFilter,
  AssetReviewFilter,
  AssetWithContext,
} from "@tendnote/db/queries/assets";
import type {
  AssetKind,
  AssetOwnership,
  AssetStatus,
  PrivacyScope,
  RecordSurfacingState,
} from "@tendnote/domain";
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

/**
 * What this viewer may do to this Asset, decided once from its ownership form
 * and the viewer's relationship to it, so no surface re-derives the Phase Eight
 * authority table and gets a row of it wrong.
 *
 * Viewing is deliberately absent: a projected Asset is one the viewer can
 * already see, so a rendered row never has to ask. What this narrows is
 * everything that *changes* the record — a member-owned Asset shared into the
 * household stays its owner's to author, while a household-native one grants
 * every active member the same authority (ADR 0214).
 *
 * A rendering hint, never the gate. The server proves every one of these again
 * on the write, against memberships read at that moment (ADR 0219).
 */
export type AssetAuthority = {
  /** Rename and re-kind. */
  edit: boolean;
  /** Archive and restore — one decision wearing two names. */
  archive: boolean;
  /** The correction/privacy delete. A household Asset is archived instead. */
  remove: boolean;
  /** Change visibility; a household Asset has no audience to change. */
  audience: boolean;
};

export function resolveAssetAuthority(ownership: AssetOwnership, owned: boolean): AssetAuthority {
  // A household-native Asset is only ever projected for a member who can see it,
  // and it is visible to every active member by definition — so "can see it" is
  // "is an active member", which is the whole of its authority test (ADR 0214).
  const householdNative = ownership === "household_native";
  return {
    edit: householdNative || owned,
    archive: householdNative || owned,
    remove: !householdNative && owned,
    audience: !householdNative && owned,
  };
}

export type AssetView = {
  id: string;
  revision: string;
  /**
   * The fence the viewer's draft is written against, sent back with an edit so a
   * second writer keeps what they typed instead of quietly overwriting the first
   * (#386). Distinct from `revision` above, which is a cache-freshness stamp.
   */
  contentRevision: number;
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
  /**
   * Whether the viewing user owns this asset. Kept for the surfaces that phrase
   * things in the first person; authority questions go through `authority`.
   */
  owned: boolean;
  /**
   * The member the row is keyed by. On a household-native Asset this is a
   * storage key and never an author — no surface may render it as one, and
   * `ownership` is what tells them apart (ADR 0214).
   */
  ownerUserId: string;
  ownership: AssetOwnership;
  /** Who is looking, so a surface can say "you" instead of naming them. */
  viewerUserId: string;
  /** What this viewer may do to it — see {@link AssetAuthority}. */
  authority: AssetAuthority;
  /**
   * Creator and last-actor provenance (ADR 0154), for the quiet attribution line
   * on a record more than one person can write. Ids, not names: the surface
   * already holds the household roster, and resolving names here would mean a
   * lookup on every row of a ledger.
   */
  createdByUserId: string | null;
  lastActorUserId: string | null;
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
    contentRevision: asset.revision,
    name: asset.name,
    kind: asset.kind,
    kindLabel: assetLabelForKind(asset.kind),
    status: asset.status,
    archived: asset.status === "archived",
    scope: asset.scope,
    visibilityLabel: surfacing.audienceLabel,
    owned: surfacing.owned,
    ownerUserId: asset.ownerUserId,
    ownership: asset.ownership,
    viewerUserId: options.callerUserId,
    authority: resolveAssetAuthority(asset.ownership, surfacing.owned),
    createdByUserId: asset.createdByUserId ?? null,
    lastActorUserId: asset.lastActorUserId ?? null,
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
