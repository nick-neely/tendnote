import type { AssetHistoryEntry, GeneralActionEventKind } from "@tendnote/domain";
import {
  assetEvidenceLabelForKind,
  assetLinkRelationLabel,
  assetPersonRelationLabel,
} from "@tendnote/domain";
import { formatSurfacingDay } from "@tendnote/domain/record-surfacing";

/**
 * One user-facing Asset History row (#202): a calm label ("Completed", "Detail
 * added", "Receipt added"), the record it names when there is one (the action's
 * title, the memory's label, the link's sentence), and a plain date. A row whose
 * record lives on its own surface carries the href to it — the action in Actions,
 * the linked asset's profile, the person's page — so history stays a retelling
 * and never becomes a second home for the record (#196).
 */
export type AssetHistoryEntryView = {
  id: string;
  label: string;
  detail: string | null;
  /** Where the named record lives, when it has a surface of its own. */
  detailHref: string | null;
  atISO: string;
  atLabel: string;
};

const ASSET_EVENT_LABELS: Record<Extract<AssetHistoryEntry, { type: "asset" }>["event"], string> = {
  added: "Added",
  archived: "Archived",
  restored: "Restored",
};

// The linked-action moments Asset History keeps (the domain filter) and how they
// read. "Added" for `created` mirrors the asset's own added row: the story is
// when the reminder arrived, not action-management jargon.
const ACTION_EVENT_LABELS: Partial<Record<GeneralActionEventKind, string>> = {
  created: "Action added",
  completed: "Completed",
  reopened: "Reopened",
  dismissed: "Dismissed",
  archived: "Archived",
};

/** The moment a history entry names, minus the shared date/id scaffolding. */
type HistoryMoment = Pick<AssetHistoryEntryView, "label" | "detail" | "detailHref">;

function assetLinkMoment(entry: Extract<AssetHistoryEntry, { type: "asset-link" }>): HistoryMoment {
  const relation = assetLinkRelationLabel(entry.relation);
  // The same sentence the Related assets section reads, from the same side.
  const detail =
    entry.direction === "outgoing"
      ? `${relation} ${entry.otherAssetName}`
      : `${entry.otherAssetName} ${relation} this`;
  return { label: "Linked", detail, detailHref: `/assets/${entry.otherAssetId}` };
}

/** Maps a derived history entry to the moment it reads as. */
function toHistoryMoment(entry: AssetHistoryEntry): HistoryMoment {
  switch (entry.type) {
    case "asset":
      return { label: ASSET_EVENT_LABELS[entry.event], detail: null, detailHref: null };
    case "memory":
      return { label: "Detail added", detail: entry.label, detailHref: null };
    case "evidence":
      // "attached", the product's own verb for evidence ("Attach evidence",
      // "Attached to Refrigerator") — and it keeps a captured *link* ("Link
      // attached") from reading like a context link ("Linked").
      return {
        label: `${assetEvidenceLabelForKind(entry.kind)} attached`,
        detail: entry.label,
        detailHref: null,
      };
    case "asset-link":
      return assetLinkMoment(entry);
    case "person-link":
      return {
        label: "Linked",
        detail: `${entry.displayName} ${assetPersonRelationLabel(entry.relation)}`,
        detailHref: `/people/${entry.personId}`,
      };
    default:
      return {
        label: ACTION_EVENT_LABELS[entry.event] ?? entry.event,
        detail: entry.actionTitle,
        detailHref: `/actions#action-${entry.actionId}`,
      };
  }
}

/** Maps a derived history entry to its serializable row view. */
export function toAssetHistoryEntryView(
  entry: AssetHistoryEntry,
  now: Date = new Date(),
): AssetHistoryEntryView {
  return {
    id: entry.id,
    atISO: entry.at.toISOString(),
    atLabel: formatSurfacingDay(entry.at, now),
    ...toHistoryMoment(entry),
  };
}
