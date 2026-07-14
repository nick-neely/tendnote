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
 * outcome, so it reports counts rather than raising an error — but it must report
 * *which* calm outcome, because there are two and they are not interchangeable.
 */
export type AssetActionProposalSummary = {
  proposed: number;
  /** Dated details that had already had their say — accepted, pending, or turned down. */
  alreadySpokenFor: number;
};

/**
 * What to tell the owner when a pass proposes nothing, or null when it proposed
 * something and the new rows speak for themselves.
 *
 * The distinction is a trust one. "The dated details here already have reminders" is a
 * comfortable sentence, and it is *false* the moment the owner has dismissed a proposal:
 * the detail has no reminder — it was refused, and saying otherwise tells the user their
 * rejection created the thing they rejected. So a settled detail is described by what
 * actually happened to it (it has been through review) rather than by an outcome we did
 * not check; and an asset with no timed details at all is told the plain truth about
 * where reminders come from, which is also the only sentence that teaches the next step.
 */
export function describeProposalOutcome(summary: AssetActionProposalSummary): string | null {
  if (summary.proposed > 0) {
    return null;
  }
  if (summary.alreadySpokenFor > 0) {
    return "Nothing new to suggest — every dated detail here has already been through review.";
  }
  return "Nothing to suggest yet — reminders come from details with a date or a cadence, like a warranty expiry or a filter interval.";
}

/** The proposal pass's result union, matching the shared surface-mutation contract. */
export type AssetActionProposalMutationResult =
  | { ok: true; view: AssetActionProposalSummary }
  | { ok: false; error: string };
