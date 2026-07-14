import type { AssetLinkedGeneralAction } from "@tendnote/db/queries/assets";
import { describeRecurrence } from "@tendnote/domain";
import { resolveSurfacing } from "@/lib/general-action-view";

/**
 * A linked General Action shaped for the Asset Profile's minimal related-actions
 * section (#199): the action's name, its Routine cadence when it has one, and one
 * calm timing/status line. Deliberately read-only — the action's own lifecycle
 * lives on the Actions surface; the profile just shows the connection.
 */
export type AssetRelatedActionView = {
  id: string;
  title: string;
  /** A calm cadence label ("Every 6 months"), or null for a one-time Action. */
  recurrenceLabel: string | null;
  /** One quiet meta line: "Due Jul 12", "Completed", "Paused", "No date", … */
  metaLabel: string;
  /** True for completed/archived actions, so the row can read as history. */
  resolved: boolean;
};

/**
 * The resolutions an asset's ledger keeps. `dismissed` is deliberately absent: a
 * dismissed action is a proposal the owner refused, and the seam already drops it
 * (`listLinkedGeneralActionsForAsset`) so the profile carries no tombstone of what it
 * was told "no" to. Completed and archived are things that happened to the thing.
 */
const RESOLVED_LABELS: Partial<Record<string, string>> = {
  completed: "Completed",
  archived: "Archived",
};

/** Maps a bridge read entry to the profile row view. */
export function toAssetRelatedActionView(
  entry: AssetLinkedGeneralAction,
  now: Date = new Date(),
): AssetRelatedActionView {
  const { action } = entry;
  const resolvedLabel = RESOLVED_LABELS[action.status];
  return {
    id: action.id,
    title: action.title,
    recurrenceLabel: action.recurrence ? describeRecurrence(action.recurrence) : null,
    metaLabel: resolvedLabel ?? resolveSurfacing(action, now).surfaceLabel,
    resolved: resolvedLabel !== undefined,
  };
}
