import type { PendingAssetActionProposal } from "@tendnote/db/queries/assets";
import { describeRecurrence } from "@tendnote/domain";
import { resolveSurfacing } from "@/lib/general-action-view";

/**
 * A still-suggested asset-derived action, shaped for the Asset Profile's review
 * affordance (#203): what Tendnote proposes, when it would land, and — the part that
 * earns the owner's trust — the exact detail it read to get there.
 *
 * `memoryLabel` is not decoration. A reminder that appears from nowhere is one the
 * owner has to reverse-engineer before they can judge it; naming "Warranty expires" or
 * "Replacement interval" is what makes accept, edit, or set-aside an informed choice
 * rather than a coin flip. Proposals are review state, so this view is owner-only.
 */
export type PendingAssetActionProposalView = {
  generalActionId: string;
  title: string;
  /** The reviewed Asset Memory that argued for this action. */
  memoryLabel: string;
  /** A calm cadence label ("Every 6 months") when the proposal is a Routine. */
  recurrenceLabel: string | null;
  /** When it would land: "Due Aug 18". */
  timingLabel: string;
};

/** Maps a pending proposal from the seam to its profile row view. */
export function toPendingAssetActionProposalView(
  entry: PendingAssetActionProposal,
  now: Date = new Date(),
): PendingAssetActionProposalView {
  const { action } = entry;
  return {
    generalActionId: action.id,
    title: action.title,
    memoryLabel: entry.memoryLabel,
    recurrenceLabel: action.recurrence ? describeRecurrence(action.recurrence) : null,
    timingLabel: resolveSurfacing(action, now).surfaceLabel,
  };
}

/**
 * What one proposal pass produced. A pass that proposes nothing is a normal, calm
 * outcome — every dated detail already has its reminder, or none of them carries a
 * date at all — so it reports a count rather than raising an error.
 */
export type AssetActionProposalSummary = { proposed: number };

/** The proposal pass's result union, matching the shared surface-mutation contract. */
export type AssetActionProposalMutationResult =
  | { ok: true; view: AssetActionProposalSummary }
  | { ok: false; error: string };
