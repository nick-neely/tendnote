import type { SavedItemWithContext } from "@tendnote/db/queries/saved-items";
import type { PrivacyScope, RecordSurfacingState, SavedItemKind } from "@tendnote/domain";
import { resolveRecordSurfacing } from "@tendnote/domain/record-surfacing";
import type { OwnerActionResult } from "@/lib/owner-action";
import type { ReminderScheduleView } from "@/lib/reminder-schedule-view";

export type SavedItemSurfaceState = Extract<RecordSurfacingState, "overdue" | "today" | "upcoming">;

export type SavedItemView = {
  id: string;
  revision: string;
  kind: SavedItemKind;
  kindLabel: string;
  title: string;
  content: string | null;
  url: string | null;
  status: "active" | "archived";
  archived: boolean;
  ownerUserId: string;
  owned: boolean;
  bringBackAt: string | null;
  bringBackState: SavedItemSurfaceState | null;
  bringBackLabel: string | null;
  scope: PrivacyScope;
  visibilityLabel: string;
  sourceRecordId: string;
  resolutionReason: string | null;
  reminderSchedule?: ReminderScheduleView | null;
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

export function toSavedItemView(
  item: SavedItemWithContext,
  now = new Date(),
  reminderSchedule: ReminderScheduleView | null = null,
  callerUserId: string = item.ownerUserId,
): SavedItemView {
  const surfacing = resolveRecordSurfacing(
    {
      kind: "saved_item",
      status: item.status,
      bringBackAt: item.bringBackAt,
      ownerUserId: item.ownerUserId,
      viewerUserId: callerUserId,
      scope: item.scope,
      sharedWithCount: item.sharedWithUserIds.length,
      householdName: item.householdName,
      updatedAt: item.updatedAt,
    },
    now,
  );
  const hasActiveBringBack = item.status === "active" && item.bringBackAt !== null;
  return {
    id: item.id,
    revision: surfacing.revision,
    kind: item.kind,
    kindLabel: KIND_LABELS[item.kind],
    title: item.title,
    content: item.content,
    url: item.url,
    status: item.status,
    archived: item.status === "archived",
    ownerUserId: item.ownerUserId,
    owned: surfacing.owned,
    bringBackAt: item.bringBackAt?.toISOString() ?? null,
    bringBackState: hasActiveBringBack ? (surfacing.state as SavedItemSurfaceState) : null,
    bringBackLabel: hasActiveBringBack ? surfacing.timingLabel : null,
    scope: item.scope,
    visibilityLabel: surfacing.audienceLabel,
    sourceRecordId: item.sourceRecordId,
    resolutionReason: item.resolutionReason,
    reminderSchedule,
    outcomes: item.outcomes.map((outcome) => ({
      destinationKind: outcome.destinationKind,
      destinationRecordId: outcome.destinationRecordId,
      label: "General Action",
    })),
  };
}

export type SavedItemMutationResult = OwnerActionResult<SavedItemView>;
