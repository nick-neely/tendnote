import type { Asset, AssetActionProposalReason, AssetAuditSource } from "@tendnote/domain";
import type { GeneralActionHydrationStore } from "../general-actions/hydrate";
import type {
  GeneralActionLifecycleStore,
  GeneralActionWithContext,
} from "../general-actions/types";
import type { AssetActionLinkStore } from "./action-link-types";

/**
 * Everything the asset→action proposal seam composes over (#203): the action↔asset
 * bridge store (assets, memories, audit, link rows, the two General Action reads) plus
 * the General Action *write* surface a proposal needs — the row, its lifecycle event,
 * and the hydration reads that present it. Composed by intersection, like the rest of
 * the asset seam, so the in-memory bridge store already satisfies it whole.
 */
export type AssetActionProposalStore = AssetActionLinkStore &
  GeneralActionHydrationStore &
  Pick<GeneralActionLifecycleStore, "createGeneralAction" | "createGeneralActionEvent">;

export type ProposeAssetMemoryActionsInput = {
  /** Proposing is owner-only, like every other review write in the asset seam. */
  actorUserId: string;
  assetId: string;
  /** Narrows the pass to specific memories; omit to consider all reviewed ones. */
  assetMemoryIds?: string[];
  /** Where the proposal originated — `user` from the profile, `assistant` from Eve. */
  source?: AssetAuditSource;
  now?: Date;
};

/** One Suggested General Action this pass created, and the memory that argued for it. */
export type AssetActionProposal = {
  reason: AssetActionProposalReason;
  assetMemoryId: string;
  action: GeneralActionWithContext;
};

/**
 * The result of one proposal pass: what it proposed, and how many details were already
 * spoken for. An empty pass is a calm result, not a failure — but it has two very
 * different causes, and a surface that cannot tell them apart is forced to guess.
 *
 * `alreadySpokenFor` is that distinction, and it is what keeps the profile honest: a
 * pass that proposed nothing because every dated detail has *already had its say*
 * (pending, accepted — or turned down) is a different sentence from a pass that proposed
 * nothing because no detail here carries a date at all. Telling the user "these already
 * have reminders" when they just rejected the only proposal is a lie the seam should
 * never have made possible.
 */
export type AssetActionProposalResult = {
  asset: Asset;
  proposed: AssetActionProposal[];
  /** Current pending review artifacts for this Asset, including proposals from prior passes. */
  pending: PendingAssetActionProposal[];
  /** Reviewed memories skipped because a prior proposal already settled them. */
  alreadySpokenFor: number;
};

export type ListPendingAssetActionProposalsInput = {
  /** Review is owner-only: only the owner sees their own pending proposals. */
  actorUserId: string;
  assetId: string;
};

/**
 * A still-suggested asset-derived action, for the Asset Profile's review affordance:
 * the proposal, plus the label of the memory that produced it — the whole reason the
 * owner can judge it fairly rather than accepting a reminder from nowhere.
 */
export type PendingAssetActionProposal = {
  assetMemoryId: string;
  memoryLabel: string;
  action: GeneralActionWithContext;
};
