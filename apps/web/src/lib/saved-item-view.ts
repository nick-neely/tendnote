import type { SavedItemWithContext } from "@tendnote/db/queries/saved-items";
import type { PrivacyScope, SavedItemKind } from "@tendnote/domain";
import { visibilityLabelForScope } from "@tendnote/domain/privacy";

export type SavedItemView = {
  id: string;
  kind: SavedItemKind;
  kindLabel: string;
  title: string;
  content: string | null;
  url: string | null;
  status: "active" | "archived";
  archived: boolean;
  bringBackAt: string | null;
  bringBackLabel: string | null;
  scope: PrivacyScope;
  visibilityLabel: string;
  sourceRecordId: string;
  resolutionReason: string | null;
  outcomes: Array<{
    destinationKind: "general_action";
    destinationRecordId: string;
    label: string;
  }>;
};

const KIND_LABELS: Record<SavedItemKind, string> = {
  note: "Note",
  link: "Link",
  open_question: "Open question",
};

export function toSavedItemView(item: SavedItemWithContext, now = new Date()): SavedItemView {
  return {
    id: item.id,
    kind: item.kind,
    kindLabel: KIND_LABELS[item.kind],
    title: item.title,
    content: item.content,
    url: item.url,
    status: item.status,
    archived: item.status === "archived",
    bringBackAt: item.bringBackAt?.toISOString() ?? null,
    bringBackLabel: item.bringBackAt
      ? `Bring back ${item.bringBackAt.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: item.bringBackAt.getFullYear() === now.getFullYear() ? undefined : "numeric",
        })}`
      : null,
    scope: item.scope,
    visibilityLabel:
      item.scope === "shared" && item.sharedWithUserIds.length
        ? `${visibilityLabelForScope(item.scope)} · ${item.sharedWithUserIds.length}`
        : (item.householdName ?? visibilityLabelForScope(item.scope)),
    sourceRecordId: item.sourceRecordId,
    resolutionReason: item.resolutionReason,
    outcomes: item.outcomes.map((outcome) => ({
      destinationKind: outcome.destinationKind,
      destinationRecordId: outcome.destinationRecordId,
      label: "General Action",
    })),
  };
}

export type SavedItemMutationResult =
  | { ok: true; view: SavedItemView }
  | { ok: false; error: string };
