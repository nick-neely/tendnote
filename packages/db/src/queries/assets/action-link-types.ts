import type { Asset, AssetAuditSource, AssetKind, GeneralAction } from "@tendnote/domain";
import type { GeneralActionStore } from "../general-actions/types";
import type { AssetReviewGroupResult, AssetReviewLifecycleStore } from "./review-types";

/**
 * Everything the action↔asset bridge composes over (#199): the asset review
 * lifecycle store (which carries the link rows) plus the two General Action
 * reads it needs — the owner-keyed load behind promotion and the scope-visible
 * load behind the related-actions read. Deliberately reads-only on the action
 * side: the bridge never mutates a General Action.
 */
export type AssetActionLinkStore = AssetReviewLifecycleStore &
  Pick<GeneralActionStore, "getGeneralAction" | "getVisibleGeneralAction">;

export type PromoteGeneralActionAssetHintInput = {
  /** Promotion is owner-only: turning a hint into a durable record is an authoring act. */
  actorUserId: string;
  generalActionId: string;
  /** The hint to promote, matched against the action's hints case-insensitively. */
  hintLabel: string;
  /** The proposed Asset Kind; defaults to `item`, correctable in review. */
  kind?: AssetKind;
  source?: AssetAuditSource;
};

/**
 * What promoting a hint produced: a pending Asset Review Group (the create-or-
 * link decision happens there, duplicate prompt included), or the durable Asset
 * this hint already resolved to — promotion is idempotent per hint.
 */
export type PromoteGeneralActionAssetHintResult =
  | { outcome: "pending_review"; group: AssetReviewGroupResult }
  | { outcome: "already_linked"; asset: Asset };

/** A linked Asset hydrated for display beside its General Action. */
export type GeneralActionLinkedAsset = {
  linkId: string;
  /** The hint this link came from, for pairing with the action's hint chips. */
  hintLabel: string | null;
  asset: Asset;
  /** True while the link still points at a pending Suggested Asset (owner-only). */
  pending: boolean;
};

/** A linked General Action hydrated for an Asset Profile's related-actions read. */
export type AssetLinkedGeneralAction = {
  linkId: string;
  hintLabel: string | null;
  action: GeneralAction;
};

export type ListLinkedAssetsInput = {
  callerUserId: string;
  generalActionIds: string[];
};

export type ListLinkedActionsInput = {
  callerUserId: string;
  assetId: string;
};
