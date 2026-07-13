import type { AssetHistoryEntry, GeneralActionEventKind } from "@tendnote/domain";

/**
 * One user-facing Asset History row (#202): a calm label ("Completed", "Detail
 * added"), the record it names when there is one (the action's title, the
 * memory's label), and a plain date. Action rows carry the action id so the row
 * can deep-link into the Actions surface — lifecycle stays over there (#196).
 */
export type AssetHistoryEntryView = {
  id: string;
  label: string;
  detail: string | null;
  /** Set for action-derived rows, for the `/actions#action-<id>` deep link. */
  actionId: string | null;
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

function formatDay(date: Date, now: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/** Maps a derived history entry to its serializable row view. */
export function toAssetHistoryEntryView(
  entry: AssetHistoryEntry,
  now: Date = new Date(),
): AssetHistoryEntryView {
  const base = { id: entry.id, atISO: entry.at.toISOString(), atLabel: formatDay(entry.at, now) };
  if (entry.type === "asset") {
    return { ...base, label: ASSET_EVENT_LABELS[entry.event], detail: null, actionId: null };
  }
  if (entry.type === "memory") {
    return { ...base, label: "Detail added", detail: entry.label, actionId: null };
  }
  return {
    ...base,
    label: ACTION_EVENT_LABELS[entry.event] ?? entry.event,
    detail: entry.actionTitle,
    actionId: entry.actionId,
  };
}
